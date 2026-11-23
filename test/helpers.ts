import { RECALL_API_BASE_URL, RECALL_REGION, type AppConfig } from "../src/config/env";
import { loadBotBackground } from "../src/domain/video";
import { MemoryRepository } from "../src/db/memoryRepository";
import { createApp, type BuiltApp } from "../src/http/app";
import { MemoryQueue } from "../src/queue/memoryQueue";
import { RecallClient } from "../src/recall/client";
import { signWebhook } from "../src/webhooks/verify";

export const TEST_SECRET = `whsec_${Buffer.from("unit-test-webhook-secret-key!!").toString("base64")}`;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    recallRegion: RECALL_REGION,
    recallApiBaseUrl: RECALL_API_BASE_URL,
    recallApiKey: "test-recall-key",
    recallWebhookVerificationSecret: TEST_SECRET,
    publicApiBaseUrl: "https://bot.gldnpr.test",
    appBaseUrl: "https://bot.gldnpr.test",
    databaseUrl: "postgresql://gldn:gldn@127.0.0.1:5432/gldn_recall",
    sessionSecret: "test-session-secret-value",
    port: 0,
    botName: "GLDN PR Notetaker",
    googleClientId: "google-client",
    googleClientSecret: "google-secret",
    googleRedirectUri: "https://bot.gldnpr.test/api/calendar/oauth/google/callback",
    appSharedPassword: "test-password",
    cookieSecure: false,
    ...overrides,
  };
}

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

export async function buildHarness(handler?: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const config = testConfig();
  const background = loadBotBackground();
  const repo = new MemoryRepository();
  const queue = new MemoryQueue();
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body,
      authorization: headers.get("authorization"),
    });
    if (handler) return handler(String(url), init);
    return new Response(JSON.stringify({ id: "recall-bot-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const recall = new RecallClient({
    apiKey: config.recallApiKey,
    sleep: async () => undefined,
    jitterSeconds: () => 1,
    fetchImpl,
  });
  const built = await createApp({
    config,
    repo,
    queue,
    recall,
    jpegBase64: background.base64,
    fetchImpl,
  });
  await queue.work(built.processJob);
  return { ...built, repo, queue, calls, config, background };
}

export async function login(app: BuiltApp["app"]): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "jj@gldnpr.com", password: "test-password" },
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  const cookie = response.cookies.find((item) => item.name === "gldn_session");
  if (!cookie) throw new Error("missing session");
  return `gldn_session=${cookie.value}`;
}

export function signedWebhook(payload: unknown, webhookId = "msg_test", timestampSeconds = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(payload);
  return {
    raw,
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(timestampSeconds),
      "webhook-signature": signWebhook({
        secret: TEST_SECRET,
        webhookId,
        timestampSeconds,
        payload: raw,
      }),
    },
  };
}
