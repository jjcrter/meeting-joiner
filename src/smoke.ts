import { RECALL_API_BASE_URL, RECALL_REGION, type AppConfig } from "./config/env";
import { loadBotBackground } from "./domain/video";
import { MemoryRepository } from "./db/memoryRepository";
import { createApp } from "./http/app";
import { MemoryQueue } from "./queue/memoryQueue";
import { RecallClient } from "./recall/client";
import { signWebhook } from "./webhooks/verify";

export function smokeConfig(): AppConfig {
  const secret = `whsec_${Buffer.from("smoke-secret-key-32-bytes!!!!").toString("base64")}`;
  return {
    recallRegion: RECALL_REGION,
    recallApiBaseUrl: RECALL_API_BASE_URL,
    recallApiKey: "smoke-api-key",
    recallWebhookVerificationSecret: secret,
    publicApiBaseUrl: "https://bot.gldnpr.test",
    appBaseUrl: "https://bot.gldnpr.test",
    databaseUrl: "postgresql://gldn:gldn@localhost:5432/gldn_recall",
    sessionSecret: "smoke-session-secret-value",
    port: 0,
    botName: "GLDN PR Notetaker",
    googleClientId: null,
    googleClientSecret: null,
    googleRedirectUri: "https://bot.gldnpr.test/api/calendar/oauth/google/callback",
    appSharedPassword: "smoke-password",
    cookieSecure: true,
    botCameraMode: "webpage",
    botCameraPageUrl: "https://bot.gldnpr.test/bot-camera",
  };
}

export async function runSmoke(): Promise<void> {
  console.log(`RECALL_REGION=${RECALL_REGION}`);
  const config = smokeConfig();
  const background = loadBotBackground();
  const repo = new MemoryRepository();
  const queue = new MemoryQueue();
  const calls: string[] = [];
  const recall = new RecallClient({
    apiKey: config.recallApiKey,
    sleep: async () => undefined,
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { meeting_url?: string }) : {};
      if (String(url).includes("/api/v1/bot/")) {
        if (JSON.stringify(body).includes("localhost")) {
          return new Response("localhost rejected", { status: 400 });
        }
        return new Response(JSON.stringify({ id: "recall-bot-smoke" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const { app, processJob } = await createApp({
    config,
    repo,
    queue,
    recall,
    jpegBase64: background.base64,
  });
  await queue.work(processJob);

  const health = await app.inject({ method: "GET", url: "/healthz" });
  if (health.statusCode !== 200 || !health.json().region) throw new Error("healthz failed");

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "jj@gldnpr.com", password: "smoke-password" },
  });
  if (login.statusCode !== 200) throw new Error(`login failed ${login.statusCode}`);
  const cookie = login.cookies.find((item) => item.name === "gldn_session");
  if (!cookie) throw new Error("session cookie missing");
  const session = `${cookie.name}=${cookie.value}`;

  const launch = await app.inject({
    method: "POST",
    url: "/api/bots",
    headers: { cookie: session },
    payload: { meetingUrl: "https://zoom.us/j/123456789" },
  });
  if (launch.statusCode !== 201) throw new Error(`launch failed ${launch.statusCode} ${launch.body}`);
  const created = launch.json().bot as { recallBotId: string; createState: string };
  if (created.recallBotId !== "recall-bot-smoke" || created.createState !== "created") {
    throw new Error("launch did not persist the Recall bot id");
  }
  const sent = calls.find((call) => call.startsWith("POST"));
  if (!sent?.includes("us-west-2.recall.ai")) throw new Error("create bot did not use us-west-2");

  const bad = await app.inject({
    method: "POST",
    url: "/api/recall/webhook",
    headers: { "content-type": "application/json", "webhook-id": "msg_bad", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,aaaa" },
    payload: JSON.stringify({ event: "bot.done", data: {} }),
  });
  if (bad.statusCode !== 400) throw new Error("bad signature was accepted");

  const payload = JSON.stringify({
    event: "bot.in_waiting_room",
    data: { data: { code: "in_waiting_room", sub_code: null, updated_at: new Date().toISOString() }, bot: { id: "recall-bot-smoke", metadata: {} } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const good = await app.inject({
    method: "POST",
    url: "/api/recall/webhook",
    headers: {
      "content-type": "application/json",
      "webhook-id": "msg_smoke",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signWebhook({
        secret: config.recallWebhookVerificationSecret,
        webhookId: "msg_smoke",
        timestampSeconds: timestamp,
        payload,
      }),
    },
    payload,
  });
  if (good.statusCode !== 200) throw new Error(`webhook rejected ${good.statusCode} ${good.body}`);
  await queue.drain();
  const detailId = launch.json().bot.id as string;
  const detail = await app.inject({ method: "GET", url: `/api/bots/${detailId}`, headers: { cookie: session } });
  if (detail.json().bot.latestStatus !== "in_waiting_room") throw new Error("status webhook did not update the bot");

  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const response = await fetch(`${address}/healthz`);
    if (!response.ok) throw new Error(`healthz via listen returned ${response.status}`);
    console.log(`smoke listen ${address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "listen failed";
    console.log(`smoke listen skipped: ${message}`);
  }
  await app.close();
  console.log("smoke ok");
}

if (require.main === module) {
  runSmoke().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
