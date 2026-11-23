import { z } from "zod";

/**
 * Only US West (Oregon) is valid for the GLDN PR workspace.
 * The API host is derived from this constant so another region cannot be configured.
 */
export const RECALL_REGION = "us-west-2" as const;
export const RECALL_API_BASE_URL = "https://us-west-2.recall.ai" as const;

const SECRET_ALIASES = [
  "RECALL_WEBHOOK_VERIFICATION_SECRET",
  "RECALL_WEBHOOK_SECRET",
  "RECALL_WORKSPACE_VERIFICATION_SECRET",
] as const;

export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, hint: string) {
    super(`Missing or invalid ${variable}. ${hint}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

export interface AppConfig {
  recallRegion: typeof RECALL_REGION;
  recallApiBaseUrl: typeof RECALL_API_BASE_URL;
  recallApiKey: string;
  recallWebhookVerificationSecret: string;
  publicApiBaseUrl: string;
  appBaseUrl: string;
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  botName: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleRedirectUri: string;
  appSharedPassword: string | null;
  cookieSecure: boolean;
}

export interface EnvSource {
  [key: string]: string | undefined;
}

function required(source: EnvSource, name: string, hint: string): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new ConfigError(name, hint);
  }
  return value;
}

function isIpHostname(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.includes(":")) return true;
  return false;
}

export function assertPublicHttpsUrl(value: string, variable: string, hint: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(variable, `${hint} It must be an absolute https URL.`);
  }
  if (url.protocol !== "https:") {
    throw new ConfigError(variable, `${hint} Use https.`);
  }
  if (value.endsWith("/")) {
    throw new ConfigError(variable, `${hint} Remove the trailing slash.`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    isIpHostname(host)
  ) {
    throw new ConfigError(
      variable,
      `${hint} Recall rejects localhost and IP addresses. Use a stable public hostname.`,
    );
  }
  return value;
}

function readWebhookSecret(source: EnvSource): string {
  const found = SECRET_ALIASES.map((name) => ({ name, value: source[name]?.trim() })).find((item) => item.value);
  if (!found?.value) {
    throw new ConfigError(
      "RECALL_WEBHOOK_VERIFICATION_SECRET",
      "Set the workspace verification secret from the us-west-2 API keys page (Developers → API Keys & Secrets → Create Workspace Secret). RECALL_WEBHOOK_SECRET and RECALL_WORKSPACE_VERIFICATION_SECRET are accepted aliases. Do not set a per-endpoint Svix secret. See README section Workspace verification secret.",
    );
  }
  if (!found.value.startsWith("whsec_")) {
    throw new ConfigError(
      found.name,
      "The workspace verification secret must start with whsec_. See README section Workspace verification secret.",
    );
  }
  const key = Buffer.from(found.value.slice("whsec_".length), "base64");
  if (key.length < 8) {
    throw new ConfigError(found.name, "The workspace verification secret is not valid base64 after whsec_.");
  }
  return found.value;
}

const googleHint =
  "Create a Web OAuth client in a GLDN-owned Google Cloud project. See README section Google OAuth.";

export function loadConfig(source: EnvSource): AppConfig {
  const region = required(
    source,
    "RECALL_REGION",
    "Set RECALL_REGION=us-west-2. The GLDN PR workspace is US West (Oregon) only. See README section Region.",
  );
  if (region !== RECALL_REGION) {
    throw new ConfigError(
      "RECALL_REGION",
      `Received ${region}. The GLDN PR workspace only exists in us-west-2. Refusing to start so requests cannot be sent to another region. See README section Region.`,
    );
  }

  const publicApiBaseUrl = assertPublicHttpsUrl(
    required(
      source,
      "PUBLIC_API_BASE_URL",
      "Set the stable public backend origin, with no trailing slash. For local development use a reserved ngrok domain. See README section Public URL.",
    ),
    "PUBLIC_API_BASE_URL",
    "See README section Public URL.",
  );

  const appBaseUrl = source.APP_BASE_URL?.trim()
    ? assertPublicHttpsUrl(source.APP_BASE_URL.trim(), "APP_BASE_URL", "See README section Public URL.")
    : publicApiBaseUrl;

  const databaseUrl = required(
    source,
    "DATABASE_URL",
    "Set a Postgres connection string. See README section Database.",
  );
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new ConfigError("DATABASE_URL", "Use a postgresql:// connection string. See README section Database.");
  }

  const sessionSecret = required(
    source,
    "SESSION_SECRET",
    "Set a long random string used to sign login cookies. See README section App session.",
  );
  if (sessionSecret.length < 16) {
    throw new ConfigError("SESSION_SECRET", "Use at least 16 characters. See README section App session.");
  }

  const googleClientId = source.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const googleClientSecret = source.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new ConfigError(
      "GOOGLE_OAUTH_CLIENT_ID",
      `Set both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET. ${googleHint}`,
    );
  }

  const derivedRedirect = `${publicApiBaseUrl}/api/calendar/oauth/google/callback`;
  const googleRedirectRaw = source.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const googleRedirectUri = googleRedirectRaw
    ? assertPublicHttpsUrl(googleRedirectRaw, "GOOGLE_OAUTH_REDIRECT_URI", googleHint)
    : derivedRedirect;

  const portValue = source.PORT?.trim() || "3000";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT", "Set PORT to an integer between 1 and 65535.");
  }

  const botName = source.BOT_NAME?.trim() || "GLDN PR Notetaker";
  const shared = source.APP_SHARED_PASSWORD?.trim() || null;

  return {
    recallRegion: RECALL_REGION,
    recallApiBaseUrl: RECALL_API_BASE_URL,
    recallApiKey: required(
      source,
      "RECALL_API_KEY",
      "Create a REST API key for us-west-2 and store it only in the host secret manager. See README section API key.",
    ),
    recallWebhookVerificationSecret: readWebhookSecret(source),
    publicApiBaseUrl,
    appBaseUrl,
    databaseUrl,
    sessionSecret,
    port,
    botName,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    appSharedPassword: shared,
    cookieSecure: publicApiBaseUrl.startsWith("https://"),
  };
}

export function configPresence(config: AppConfig, source: EnvSource): Record<string, boolean> {
  return {
    RECALL_REGION: source.RECALL_REGION?.trim() === RECALL_REGION,
    RECALL_API_KEY: Boolean(config.recallApiKey),
    RECALL_WEBHOOK_VERIFICATION_SECRET: config.recallWebhookVerificationSecret.startsWith("whsec_"),
    PUBLIC_API_BASE_URL: Boolean(config.publicApiBaseUrl),
    DATABASE_URL: Boolean(config.databaseUrl),
    SESSION_SECRET: Boolean(config.sessionSecret),
    GOOGLE_OAUTH_CLIENT_ID: Boolean(config.googleClientId),
    GOOGLE_OAUTH_CLIENT_SECRET: Boolean(config.googleClientSecret),
    GOOGLE_OAUTH_REDIRECT_URI: Boolean(source.GOOGLE_OAUTH_REDIRECT_URI?.trim()),
    APP_SHARED_PASSWORD: Boolean(config.appSharedPassword),
    BOT_NAME: Boolean(source.BOT_NAME?.trim()),
  };
}

export function loadConfigFromProcess(): AppConfig {
  return loadConfig(process.env);
}

export const envSchemaForTests = z.object({
  RECALL_REGION: z.literal(RECALL_REGION),
});
