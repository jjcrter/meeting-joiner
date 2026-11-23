import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import type { AppConfig } from "../config/env";
import { configPresence } from "../config/env";
import { RECALL_REGION } from "../config/env";
import type { Repository, UserRecord } from "../db/types";
import { createWebhookProcessor } from "../jobs/processWebhook";
import type { JobQueue, WebhookJob } from "../queue/types";
import { RecallClient } from "../recall/client";
import { findOrConnectGoogleCalendar, setRecordingRule, setSeriesOverride, syncRecallEvents } from "../services/calendar";
import { exchangeGoogleAuthCode, googleAuthUrl, GoogleOAuthError } from "../services/google";
import { LaunchError, launchBot } from "../services/launch";
import { isRecordingRule } from "../domain/shouldRecord";
import { verifyRequestFromRecall, WebhookVerificationError } from "../webhooks/verify";
import { readState, signState } from "./state";

export interface AppDeps {
  config: AppConfig;
  repo: Repository;
  queue: JobQueue;
  recall: RecallClient;
  jpegBase64: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface BuiltApp {
  app: FastifyInstance;
  processJob: (job: WebhookJob) => Promise<void>;
}

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_COOKIE = "gldn_session";

interface SessionPayload {
  userId: string;
  email: string;
  exp: number;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const a = crypto.createHash("sha256").update(left).digest();
  const b = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function createApp(deps: AppDeps): Promise<BuiltApp> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['webhook-signature']",
              "req.headers['svix-signature']",
            ],
          },
  });
  const processJob = createWebhookProcessor({
    repo: deps.repo,
    recall: deps.recall,
    config: deps.config,
    jpegBase64: deps.jpegBase64,
    now: deps.now,
  });

  await app.register(cookie, { secret: deps.config.sessionSecret, hook: "onRequest" });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const raw = (body as Buffer).toString("utf8");
    const pathname = request.url.split("?")[0];
    if (pathname === "/api/recall/webhook") {
      done(null, { raw });
      return;
    }
    if (!raw) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch {
      const error = new Error("Invalid JSON") as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", details: error.issues.map((issue) => issue.message) });
    }
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof LaunchError || error instanceof GoogleOAuthError) {
      return reply.code(400).send({ error: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : "Request failed";
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: message });
    request.log.error({ message }, "request failed");
    return reply.code(500).send({ error: "Internal error" });
  });

  function setSession(reply: FastifyReply, user: UserRecord): void {
    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    reply.setCookie(SESSION_COOKIE, JSON.stringify(payload), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: deps.config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  async function currentUser(request: FastifyRequest): Promise<UserRecord | null> {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return null;
    let payload: SessionPayload;
    try {
      payload = JSON.parse(unsigned.value) as SessionPayload;
    } catch {
      return null;
    }
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return deps.repo.getUser(payload.userId);
  }

  async function requireUser(request: FastifyRequest): Promise<UserRecord> {
    const user = await currentUser(request);
    if (!user) throw new HttpError(401, "Sign in required.");
    return user;
  }

  app.get("/healthz", async () => ({ ok: true, region: RECALL_REGION }));

  app.post("/api/auth/login", async (request, reply) => {
    if (!deps.config.appSharedPassword) throw new HttpError(404, "Password login is disabled.");
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
    const email = body.email.toLowerCase();
    if (!email.endsWith("@gldnpr.com")) throw new HttpError(403, "Use a @gldnpr.com account.");
    if (!timingSafeStringEqual(body.password, deps.config.appSharedPassword)) {
      throw new HttpError(401, "Invalid email or password.");
    }
    const user = await deps.repo.upsertUser({ email });
    setSession(reply, user);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/session", async (request) => {
    const user = await currentUser(request);
    return { user: user ? { id: user.id, email: user.email, name: user.name } : null };
  });

  app.get("/api/auth/google", async (request, reply) => {
    if (!deps.config.googleClientId) {
      throw new HttpError(503, "Google sign-in is not configured. See README section Google OAuth.");
    }
    const state = signState(deps.config.sessionSecret, {
      purpose: "login",
      nonce: crypto.randomUUID(),
      exp: Date.now() + 15 * 60 * 1000,
    });
    const redirectUri = `${deps.config.publicApiBaseUrl}/api/auth/google/callback`;
    return reply.redirect(
      googleAuthUrl({
        clientId: deps.config.googleClientId,
        redirectUri,
        state,
        scope: "openid email profile",
      }),
    );
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const query = z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }).parse(request.query);
    if (query.error || !query.code) {
      return reply.redirect(`${deps.config.appBaseUrl}/login?error=google`);
    }
    const state = readState(deps.config.sessionSecret, query.state, deps.now?.() ?? new Date());
    if (state.purpose !== "login") throw new HttpError(400, "OAuth state was not for sign-in.");
    const profile = await exchangeGoogleAuthCode({
      config: deps.config,
      code: query.code,
      redirectUri: `${deps.config.publicApiBaseUrl}/api/auth/google/callback`,
      fetchImpl: deps.fetchImpl,
    });
    const user = await deps.repo.upsertUser({ email: profile.email, name: profile.name });
    setSession(reply, user);
    return reply.redirect(`${deps.config.appBaseUrl}/`);
  });

  app.get("/api/health", async (request) => {
    await requireUser(request);
    const source = process.env;
    return {
      region: RECALL_REGION,
      apiBaseUrl: deps.config.recallApiBaseUrl,
      webhookUrl: `${deps.config.publicApiBaseUrl}/api/recall/webhook`,
      env: configPresence(deps.config, source),
      googleOAuth: Boolean(deps.config.googleClientId && deps.config.googleClientSecret),
      cameraMode: deps.config.botCameraMode,
      cameraPageUrl: deps.config.botCameraPageUrl,
      lastWebhookReceivedAt: await deps.repo.lastWebhookReceivedAt(),
    };
  });

  app.post("/api/bots", async (request, reply) => {
    const user = await requireUser(request);
    const body = z
      .object({
        meetingUrl: z.string().min(1),
        botName: z.string().trim().min(1).max(80).optional(),
        joinAt: z.string().optional(),
        joinAtEastern: z.string().optional(),
        transcriptEnabled: z.boolean().optional(),
        chatNoticeEnabled: z.boolean().optional(),
      })
      .parse(request.body);
    const bot = await launchBot({
      repo: deps.repo,
      recall: deps.recall,
      config: deps.config,
      jpegBase64: deps.jpegBase64,
      userId: user.id,
      userEmail: user.email,
      now: deps.now?.(),
      ...body,
    });
    const status = bot.createState === "created" ? 201 : bot.createState === "uncertain" ? 202 : 502;
    return reply.code(status).send({ bot });
  });

  app.get("/api/bots", async (request) => {
    await requireUser(request);
    return { bots: await deps.repo.listBots() };
  });

  app.get("/api/bots/:id", async (request) => {
    await requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const bot = await deps.repo.getBot(id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const recordings = await deps.repo.listRecordingsForBot(bot.id);
    const transcripts = [];
    for (const recording of recordings) {
      transcripts.push(...(await deps.repo.listTranscriptsForRecording(recording.id)));
    }
    return {
      bot,
      statusEvents: await deps.repo.listStatusEvents(bot.id),
      recordings,
      transcripts,
      dashboardUrl: bot.recallBotId
        ? `https://us-west-2.recall.ai/dashboard/explorer/bot/${bot.recallBotId}`
        : "https://us-west-2.recall.ai/dashboard/",
    };
  });

  app.get("/api/bots/:id/transcript.txt", async (request, reply) => {
    await requireUser(request);
    const text = await transcriptText(deps.repo, request);
    return reply.type("text/plain; charset=utf-8").send(text);
  });

  app.get("/api/bots/:id/transcript.json", async (request, reply) => {
    await requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const bot = await deps.repo.getBot(id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const recordings = await deps.repo.listRecordingsForBot(bot.id);
    const payloads = [];
    for (const recording of recordings) {
      for (const transcript of await deps.repo.listTranscriptsForRecording(recording.id)) {
        if (transcript.rawJson) payloads.push(transcript.rawJson);
      }
    }
    if (payloads.length === 0) throw new HttpError(404, "Transcript is not ready.");
    return reply.type("application/json").send(payloads.length === 1 ? payloads[0] : payloads);
  });

  app.post("/api/bots/:id/cancel", async (request) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const bot = await deps.repo.getBot(id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    if (!bot.recallBotId) throw new HttpError(409, "This bot was never created in Recall.");
    if (bot.latestStatus !== "scheduled") {
      throw new HttpError(409, "Only a bot that has not joined yet can be cancelled.");
    }
    await deps.recall.deleteBot(bot.recallBotId);
    return { bot: await deps.repo.updateBot(bot.id, { latestStatus: "cancelled" }), cancelledBy: user.email };
  });

  app.post("/api/bots/:id/leave", async (request) => {
    await requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const bot = await deps.repo.getBot(id);
    if (!bot?.recallBotId) throw new HttpError(404, "Bot not found.");
    await deps.recall.leaveCall(bot.recallBotId);
    return { bot: await deps.repo.updateBot(bot.id, { latestStatus: "leaving" }) };
  });

  app.get("/api/events/stream", async (request, reply) => {
    await requireUser(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
    const timer = setInterval(() => {
      reply.raw.write(`data: ${JSON.stringify({ type: "refresh" })}\n\n`);
    }, 2000);
    request.raw.on("close", () => clearInterval(timer));
  });

  app.get("/api/calendar", async (request) => {
    const user = await requireUser(request);
    const calendar = await deps.repo.getCalendarForUser(user.id);
    const prefs = await deps.repo.getPrefs(user.id);
    const events = calendar ? await deps.repo.listUpcomingEvents(calendar.id, deps.now?.() ?? new Date()) : [];
    return {
      calendar,
      prefs,
      events,
      googleConfigured: Boolean(deps.config.googleClientId),
    };
  });

  app.get("/api/calendar/oauth/google", async (request, reply) => {
    const user = await requireUser(request);
    if (!deps.config.googleClientId) {
      throw new HttpError(503, "Google OAuth is not configured. See README section Google OAuth.");
    }
    const state = signState(deps.config.sessionSecret, {
      purpose: "calendar",
      userId: user.id,
      nonce: crypto.randomUUID(),
      exp: Date.now() + 15 * 60 * 1000,
    });
    return reply.redirect(
      googleAuthUrl({
        clientId: deps.config.googleClientId,
        redirectUri: deps.config.googleRedirectUri,
        state,
        scope: "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email",
        offline: true,
      }),
    );
  });

  app.get("/api/calendar/oauth/google/callback", async (request, reply) => {
    const user = await requireUser(request);
    const query = z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }).parse(request.query);
    if (query.error || !query.code) {
      return reply.redirect(`${deps.config.appBaseUrl}/calendar?error=access_denied`);
    }
    const state = readState(deps.config.sessionSecret, query.state, deps.now?.() ?? new Date());
    if (state.purpose !== "calendar" || state.userId !== user.id) {
      throw new HttpError(400, "OAuth state does not match this signed-in user.");
    }
    const profile = await exchangeGoogleAuthCode({
      config: deps.config,
      code: query.code,
      redirectUri: deps.config.googleRedirectUri,
      fetchImpl: deps.fetchImpl,
    });
    if (!profile.refreshToken) {
      throw new GoogleOAuthError(
        "Google did not return a refresh token. Remove GLDN PR's access in the Google Account permissions page, then connect again.",
      );
    }
    const remote = await findOrConnectGoogleCalendar({
      recall: deps.recall,
      config: deps.config,
      userId: user.id,
      email: profile.email,
      refreshToken: profile.refreshToken,
    });
    const calendar = await deps.repo.upsertCalendar({
      id: randomId(),
      recallCalendarId: remote.id,
      userId: user.id,
      platform: "google_calendar",
      platformEmail: (remote.platform_email || profile.email).toLowerCase(),
      status: remote.status ?? "connected",
      lastSyncedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const prefs = await deps.repo.getPrefs(user.id);
    await syncRecallEvents({
      repo: deps.repo,
      recall: deps.recall,
      config: deps.config,
      jpegBase64: deps.jpegBase64,
      calendar,
      user,
      prefs,
      now: deps.now?.(),
    });
    return reply.redirect(`${deps.config.appBaseUrl}/calendar`);
  });

  app.post("/api/calendar/sync", async (request) => {
    const user = await requireUser(request);
    const calendar = await requireCalendar(deps.repo, user.id);
    const prefs = await deps.repo.getPrefs(user.id);
    await syncRecallEvents({
      repo: deps.repo,
      recall: deps.recall,
      config: deps.config,
      jpegBase64: deps.jpegBase64,
      calendar,
      user,
      prefs,
      now: deps.now?.(),
    });
    return { ok: true };
  });

  app.put("/api/calendar/prefs", async (request) => {
    const user = await requireUser(request);
    const body = z.object({ rule: z.string() }).parse(request.body);
    if (!isRecordingRule(body.rule)) throw new HttpError(400, "Rule must be manual, auto_all, or external_only.");
    const calendar = await requireCalendar(deps.repo, user.id);
    const prefs = await setRecordingRule({
      repo: deps.repo,
      recall: deps.recall,
      config: deps.config,
      jpegBase64: deps.jpegBase64,
      user,
      calendar,
      rule: body.rule,
      now: deps.now?.(),
    });
    return { prefs };
  });

  app.post("/api/calendar/events/:id/recording", async (request) => {
    const user = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ record: z.boolean() }).parse(request.body);
    const calendar = await requireCalendar(deps.repo, user.id);
    const event = await deps.repo.getCalendarEvent(params.id);
    if (!event || event.calendarId !== calendar.id) throw new HttpError(404, "Calendar event not found.");
    await setSeriesOverride({
      repo: deps.repo,
      recall: deps.recall,
      config: deps.config,
      jpegBase64: deps.jpegBase64,
      user,
      calendar,
      event,
      record: body.record,
      now: deps.now?.(),
    });
    return { event: await deps.repo.getCalendarEvent(params.id) };
  });

  app.delete("/api/calendar", async (request) => {
    const user = await requireUser(request);
    const calendar = await requireCalendar(deps.repo, user.id);
    await deps.recall.deleteCalendar(calendar.recallCalendarId);
    const updated = await deps.repo.updateCalendar(calendar.id, { status: "disconnected" });
    return { calendar: updated };
  });

  app.post("/api/recall/webhook", async (request, reply) => {
    const raw = (request.body as { raw?: string } | undefined)?.raw ?? "";
    const headers = request.headers as Record<string, string | string[] | undefined>;
    let multipleSignatures = false;
    try {
      verifyRequestFromRecall({
        secret: deps.config.recallWebhookVerificationSecret,
        headers,
        payload: raw,
        now: deps.now?.(),
        onMultipleSignatures: () => {
          multipleSignatures = true;
        },
      });
    } catch (error) {
      const webhookId = headerValue(headers, "webhook-id") ?? headerValue(headers, "svix-id");
      request.log.warn(
        { webhookId, reason: error instanceof WebhookVerificationError ? error.message : "verification failed" },
        "webhook verification failed",
      );
      return reply.code(400).send({ error: "Invalid webhook signature" });
    }
    if (multipleSignatures) {
      request.log.warn("Recall webhook included multiple signatures; workspace secret rotation may be in progress.");
    }
    let parsed: { event?: string };
    try {
      parsed = JSON.parse(raw) as { event?: string };
    } catch {
      return reply.code(400).send({ error: "Invalid JSON" });
    }
    if (!parsed.event) return reply.code(400).send({ error: "Webhook event is missing." });
    const webhookId = headerValue(headers, "webhook-id") ?? headerValue(headers, "svix-id");
    if (!webhookId) return reply.code(400).send({ error: "Webhook id is missing." });
    const inserted = await deps.repo.insertWebhook({
      webhookId,
      event: parsed.event,
      payload: JSON.parse(raw) as unknown,
      verified: true,
      status: "queued",
      error: null,
      receivedAt: new Date().toISOString(),
      processedAt: null,
    });
    if (!inserted.inserted) return reply.code(200).send({ ok: true, duplicate: true });
    try {
      await deps.queue.enqueue({ webhookId });
    } catch (error) {
      await deps.repo.deleteWebhook(webhookId);
      request.log.error({ message: error instanceof Error ? error.message : "enqueue failed" }, "webhook enqueue failed");
      return reply.code(500).send({ error: "Failed to enqueue webhook" });
    }
    return reply.code(200).send({ ok: true });
  });

  app.get("/brand/bot-background.jpg", async (_request, reply) => {
    const file = path.resolve(process.cwd(), "assets/bot-background.jpg");
    return reply.type("image/jpeg").send(fs.readFileSync(file));
  });

  app.get("/bot-camera", async (_request, reply) => {
    reply.header("cache-control", "no-cache");
    return reply.type("text/html; charset=utf-8").send(botCameraHtml());
  });

  app.get("/media/gldn-brand-03-loop.mp4", async (request, reply) => {
    const range = Array.isArray(request.headers.range) ? request.headers.range[0] : request.headers.range;
    return sendCameraLoop(range, reply);
  });

  const webDist = path.resolve(process.cwd(), "web/dist");
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/healthz")) {
      return reply.code(404).send({ error: "Not found" });
    }
    const indexHtml = path.join(webDist, "index.html");
    if (fs.existsSync(indexHtml)) return reply.type("text/html").send(fs.readFileSync(indexHtml));
    return reply.code(404).send({ error: "Not found" });
  });

  return { app, processJob };
}

const CAMERA_LOOP_PATH = path.resolve(process.cwd(), "assets/gldn-brand-03-loop.mp4");

function botCameraHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280, initial-scale=1">
<title>GLDN</title>
<style>
  html, body { margin: 0; padding: 0; width: 1280px; height: 720px; overflow: hidden; background: #0e1a2e; }
  video { display: block; width: 1280px; height: 720px; margin: 0; object-fit: contain; background: #0e1a2e; image-rendering: auto; }
</style>
</head>
<body>
<video id="tile" width="1280" height="720" src="/media/gldn-brand-03-loop.mp4" autoplay muted loop playsinline preload="auto"></video>
<script>
(function () {
  var video = document.getElementById("tile");
  var ratio = window.devicePixelRatio || 1;
  if (ratio !== 1) {
    var cssWidth = 1280 / ratio;
    var cssHeight = 720 / ratio;
    var scale = 1 / ratio;
    var viewport = document.querySelector('meta[name="viewport"]');
    viewport.setAttribute("content", "width=1280, initial-scale=" + scale + ", minimum-scale=" + scale + ", maximum-scale=" + scale + ", user-scalable=no");
    document.documentElement.style.width = cssWidth + "px";
    document.documentElement.style.height = cssHeight + "px";
    document.body.style.width = cssWidth + "px";
    document.body.style.height = cssHeight + "px";
    video.style.width = cssWidth + "px";
    video.style.height = cssHeight + "px";
  }
  var arm = function () {
    if (!isFinite(video.duration)) return;
    video.addEventListener("timeupdate", function () {
      if (video.currentTime >= video.duration - (1 / 30)) video.currentTime = 0;
    });
  };
  if (video.readyState >= 1) arm();
  else video.addEventListener("loadedmetadata", arm);
  var started = video.play();
  if (started && started.catch) started.catch(function () {});
})();
</script>
</body>
</html>`;
}

function sendCameraLoop(rangeHeader: string | undefined, reply: FastifyReply) {
  if (!fs.existsSync(CAMERA_LOOP_PATH)) {
    return reply.code(404).send({ error: "Camera loop is missing." });
  }
  const size = fs.statSync(CAMERA_LOOP_PATH).size;
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "public, max-age=3600");
  reply.type("video/mp4");
  if (!rangeHeader) {
    reply.header("content-length", size);
    return reply.send(fs.createReadStream(CAMERA_LOOP_PATH));
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    reply.header("content-range", `bytes */${size}`);
    return reply.code(416).send();
  }
  const start = match[1] === "" ? Math.max(size - Number(match[2]), 0) : Number(match[1]);
  let end = match[2] === "" || match[1] === "" ? size - 1 : Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    reply.header("content-range", `bytes */${size}`);
    return reply.code(416).send();
  }
  end = Math.min(end, size - 1);
  reply.code(206);
  reply.header("content-range", `bytes ${start}-${end}/${size}`);
  reply.header("content-length", String(end - start + 1));
  return reply.send(fs.createReadStream(CAMERA_LOOP_PATH, { start, end }));
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function randomId(): string {
  return crypto.randomUUID();
}

async function requireCalendar(repo: Repository, userId: string) {
  const calendar = await repo.getCalendarForUser(userId);
  if (!calendar || calendar.status === "disconnected") {
    throw new HttpError(409, "Connect Google Calendar first.");
  }
  return calendar;
}

async function transcriptText(repo: Repository, request: FastifyRequest): Promise<string> {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const bot = await repo.getBot(id);
  if (!bot) throw new HttpError(404, "Bot not found.");
  const recordings = await repo.listRecordingsForBot(bot.id);
  const chunks: string[] = [];
  for (const recording of recordings) {
    for (const transcript of await repo.listTranscriptsForRecording(recording.id)) {
      if (transcript.readableText) chunks.push(transcript.readableText);
    }
  }
  if (chunks.length === 0) throw new HttpError(404, "Transcript is not ready.");
  return chunks.join("\n\n");
}
