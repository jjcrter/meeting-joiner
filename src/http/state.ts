import crypto from "node:crypto";
import { z } from "zod";

const StateSchema = z.object({
  purpose: z.enum(["login", "calendar"]),
  userId: z.string().optional(),
  nonce: z.string(),
  exp: z.number(),
});

export type SignedState = z.infer<typeof StateSchema>;

export function signState(secret: string, payload: SignedState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readState(secret: string, token: string, now = new Date()): SignedState {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("OAuth state is invalid.");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error("OAuth state signature does not match.");
  }
  const parsed = StateSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (parsed.exp < now.getTime()) throw new Error("OAuth state expired. Start the connection again.");
  return parsed;
}
