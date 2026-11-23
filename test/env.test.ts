import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/env";

const complete = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: `whsec_${Buffer.from("env-test-secret-value-ok!!!!").toString("base64")}`,
  PUBLIC_API_BASE_URL: "https://bot.gldnpr.test",
  DATABASE_URL: "postgresql://gldn:gldn@localhost:5432/gldn_recall",
  SESSION_SECRET: "a-long-session-secret",
};

describe("loadConfig", () => {
  it("accepts the canonical secret and prints only us-west-2", () => {
    const config = loadConfig(complete);
    expect(config.recallRegion).toBe("us-west-2");
    expect(config.recallApiBaseUrl).toBe("https://us-west-2.recall.ai");
    expect(config.botName).toBe("GLDN PR Notetaker");
  });

  it.each([
    "RECALL_REGION",
    "RECALL_API_KEY",
    "PUBLIC_API_BASE_URL",
    "DATABASE_URL",
    "SESSION_SECRET",
  ])("names a missing %s", (name) => {
    const source: Record<string, string> = { ...complete };
    delete source[name];
    expect(() => loadConfig(source)).toThrow(ConfigError);
    try {
      loadConfig(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variable).toBe(name);
      expect((error as Error).message).toContain(name);
    }
  });

  it("names the webhook secret when every alias is missing", () => {
    const source: Record<string, string> = { ...complete };
    delete source.RECALL_WEBHOOK_VERIFICATION_SECRET;
    expect(() => loadConfig(source)).toThrow(/RECALL_WEBHOOK_VERIFICATION_SECRET/);
  });

  it("accepts RECALL_WEBHOOK_SECRET as the workspace verification secret", () => {
    const source: Record<string, string> = { ...complete };
    delete source.RECALL_WEBHOOK_VERIFICATION_SECRET;
    const config = loadConfig({ ...source, RECALL_WEBHOOK_SECRET: complete.RECALL_WEBHOOK_VERIFICATION_SECRET });
    expect(config.recallWebhookVerificationSecret.startsWith("whsec_")).toBe(true);
  });

  it("rejects any region other than us-west-2", () => {
    expect(() => loadConfig({ ...complete, RECALL_REGION: "us-east-1" })).toThrow(/us-west-2/);
  });

  it("defaults the camera to the webpage loop and rejects unknown modes", () => {
    expect(loadConfig(complete).botCameraMode).toBe("webpage");
    expect(loadConfig(complete).botCameraPageUrl).toBe("https://bot.gldnpr.test/bot-camera");
    expect(loadConfig({ ...complete, BOT_CAMERA_MODE: "image" }).botCameraMode).toBe("image");
    expect(() => loadConfig({ ...complete, BOT_CAMERA_MODE: "gif" })).toThrow(/BOT_CAMERA_MODE/);
  });

  it("rejects localhost and trailing slashes on the public URL", () => {
    expect(() => loadConfig({ ...complete, PUBLIC_API_BASE_URL: "http://localhost:3000" })).toThrow(/PUBLIC_API_BASE_URL/);
    expect(() => loadConfig({ ...complete, PUBLIC_API_BASE_URL: "https://bot.gldnpr.test/" })).toThrow(/trailing slash/);
    expect(() => loadConfig({ ...complete, PUBLIC_API_BASE_URL: "https://127.0.0.1" })).toThrow(/IP/);
  });
});
