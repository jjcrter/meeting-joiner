const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

export function containsForbiddenAddress(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return false;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(text)) return true;
  const urls = text.match(/https?:\/\/[^\s"'\\]+/gi) ?? [];
  for (const candidate of urls) {
    try {
      const host = new URL(candidate).hostname;
      if (PRIVATE_HOST.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function assertNoLocalhost(value: unknown): void {
  if (containsForbiddenAddress(value)) {
    throw new Error(
      "Refusing to send localhost or an IP address to Recall. Use the public https backend URL. See README section Public URL.",
    );
  }
}

export function assertDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Transcript download URL was not absolute.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Transcript download URL must be https.");
  }
  if (PRIVATE_HOST.test(parsed.hostname) || /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
    throw new Error("Refusing to download a transcript from a local or IP host.");
  }
}

export function isUsWestRecallUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "us-west-2.recall.ai";
  } catch {
    return false;
  }
}
