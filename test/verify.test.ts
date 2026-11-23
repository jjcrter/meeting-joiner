import { describe, expect, it } from "vitest";
import { signWebhook, verifyRequestFromRecall, WebhookVerificationError } from "../src/webhooks/verify";
import { TEST_SECRET } from "./helpers";

const payload = JSON.stringify({ event: "bot.done", data: { bot: { id: "b1" } } });
const now = new Date("2026-11-23T20:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1000);

function headers(signature: string, extra?: Record<string, string>) {
  return {
    "webhook-id": "msg_1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signature,
    ...extra,
  };
}

describe("verifyRequestFromRecall", () => {
  it("accepts a valid signature", () => {
    const signature = signWebhook({ secret: TEST_SECRET, webhookId: "msg_1", timestampSeconds: timestamp, payload });
    expect(() =>
      verifyRequestFromRecall({ secret: TEST_SECRET, headers: headers(signature), payload, now }),
    ).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const signature = signWebhook({ secret: TEST_SECRET, webhookId: "msg_1", timestampSeconds: timestamp, payload });
    expect(() =>
      verifyRequestFromRecall({ secret: TEST_SECRET, headers: headers(signature), payload: `${payload} `, now }),
    ).toThrow(WebhookVerificationError);
  });

  it("rejects the wrong secret", () => {
    const other = `whsec_${Buffer.from("another-webhook-secret-value!").toString("base64")}`;
    const signature = signWebhook({ secret: other, webhookId: "msg_1", timestampSeconds: timestamp, payload });
    expect(() => verifyRequestFromRecall({ secret: TEST_SECRET, headers: headers(signature), payload, now })).toThrow(
      /signature/,
    );
  });

  it("accepts one matching signature among several and reports rotation", () => {
    const signature = signWebhook({ secret: TEST_SECRET, webhookId: "msg_1", timestampSeconds: timestamp, payload });
    let rotations = 0;
    verifyRequestFromRecall({
      secret: TEST_SECRET,
      headers: headers(`v1,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa= ${signature}`),
      payload,
      now,
      onMultipleSignatures: () => {
        rotations += 1;
      },
    });
    expect(rotations).toBe(1);
  });

  it("rejects missing headers", () => {
    expect(() => verifyRequestFromRecall({ secret: TEST_SECRET, headers: {}, payload, now })).toThrow(/Missing/);
  });

  it("rejects a stale timestamp", () => {
    const old = timestamp - 10 * 60;
    const signature = signWebhook({ secret: TEST_SECRET, webhookId: "msg_1", timestampSeconds: old, payload });
    expect(() =>
      verifyRequestFromRecall({
        secret: TEST_SECRET,
        headers: {
          "webhook-id": "msg_1",
          "webhook-timestamp": String(old),
          "webhook-signature": signature,
        },
        payload,
        now,
      }),
    ).toThrow(/5 minute/);
  });

  it("accepts svix header names", () => {
    const signature = signWebhook({ secret: TEST_SECRET, webhookId: "msg_1", timestampSeconds: timestamp, payload });
    expect(() =>
      verifyRequestFromRecall({
        secret: TEST_SECRET,
        headers: { "svix-id": "msg_1", "svix-timestamp": String(timestamp), "svix-signature": signature },
        payload,
        now,
      }),
    ).not.toThrow();
  });
});
