import type { AppConfig } from "../config/env";
import { z } from "zod";

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export function assertGldnEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith("@gldnpr.com")) {
    throw new GoogleOAuthError("Sign in with a @gldnpr.com Google account.");
  }
  return normalized;
}

export async function exchangeGoogleAuthCode(args: {
  config: AppConfig;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ email: string; name: string | null; refreshToken: string | null; accessToken: string }> {
  if (!args.config.googleClientId || !args.config.googleClientSecret) {
    throw new GoogleOAuthError(
      "Google OAuth is not configured. See README section Google OAuth.",
    );
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.config.googleClientId,
    client_secret: args.config.googleClientSecret,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!tokenResponse.ok) {
    throw new GoogleOAuthError(`Google token exchange failed (status ${tokenResponse.status}).`);
  }
  const tokens = z
    .object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
      expires_in: z.number().optional(),
    })
    .parse(await tokenResponse.json());

  const profileResponse = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
  });
  if (!profileResponse.ok) {
    throw new GoogleOAuthError(`Google profile lookup failed (status ${profileResponse.status}).`);
  }
  const profile = z
    .object({
      email: z.string().email(),
      name: z.string().optional(),
    })
    .parse(await profileResponse.json());

  return {
    email: assertGldnEmail(profile.email),
    name: profile.name ?? null,
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token,
  };
}

export function googleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  offline?: boolean;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", args.scope);
  url.searchParams.set("state", args.state);
  url.searchParams.set("hd", "gldnpr.com");
  url.searchParams.set("include_granted_scopes", "false");
  if (args.offline) {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}
