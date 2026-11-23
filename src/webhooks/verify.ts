import crypto from "node:crypto";

const MAX_SKEW_SECONDS = 5 * 60;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface VerifyInput {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body. Use null for GET or websocket upgrade, which have no payload. */
  payload: string | null;
  now?: Date;
  onMultipleSignatures?: () => void;
}

function header(headers: VerifyInput["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function signatures(headerValue: string): string[] {
  return headerValue
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Verify a dashboard webhook, realtime request, or callback from Recall.
 * Dashboard webhooks for this workspace use the workspace verification secret
 * and webhook-* headers (svix-* is accepted as a fallback).
 * Timestamps older than five minutes are rejected.
 */
export function verifyRequestFromRecall(input: VerifyInput): void {
  const secret = input.secret;
  if (!secret || !secret.startsWith("whsec_")) {
    throw new WebhookVerificationError("Webhook verification secret is missing or invalid.");
  }

  const msgId = header(input.headers, "webhook-id") ?? header(input.headers, "svix-id");
  const msgTimestamp = header(input.headers, "webhook-timestamp") ?? header(input.headers, "svix-timestamp");
  const msgSignature = header(input.headers, "webhook-signature") ?? header(input.headers, "svix-signature");
  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new WebhookVerificationError("Missing webhook id, timestamp, or signature header.");
  }

  const timestampSeconds = Number(msgTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new WebhookVerificationError("Webhook timestamp is not a number.");
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_SKEW_SECONDS) {
    throw new WebhookVerificationError("Webhook timestamp is outside the 5 minute window.");
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const payloadStr = input.payload ?? "";
  const expected = crypto.createHmac("sha256", key).update(`${msgId}.${msgTimestamp}.${payloadStr}`).digest("base64");
  const expectedBytes = Buffer.from(expected, "base64");

  const presented = signatures(msgSignature);
  const versioned = presented.filter((part) => part.startsWith("v1,"));
  if (versioned.length > 1) {
    input.onMultipleSignatures?.();
  }

  for (const versionedSig of presented) {
    const comma = versionedSig.indexOf(",");
    if (comma === -1) continue;
    const version = versionedSig.slice(0, comma);
    const signature = versionedSig.slice(comma + 1);
    if (version !== "v1" || !signature) continue;
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(signature, "base64");
    } catch {
      continue;
    }
    if (sigBytes.length !== expectedBytes.length) continue;
    if (crypto.timingSafeEqual(sigBytes, expectedBytes)) return;
  }

  throw new WebhookVerificationError("No matching webhook signature.");
}

export function signWebhook(args: {
  secret: string;
  webhookId: string;
  timestampSeconds: number;
  payload: string;
}): string {
  const key = Buffer.from(args.secret.slice("whsec_".length), "base64");
  const digest = crypto
    .createHmac("sha256", key)
    .update(`${args.webhookId}.${args.timestampSeconds}.${args.payload}`)
    .digest("base64");
  return `v1,${digest}`;
}
