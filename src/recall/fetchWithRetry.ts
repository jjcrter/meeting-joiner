export interface FetchWithRetryArgs {
  url: string;
  options: RequestInit;
  maxAttempts?: number;
  /** Calendar schedule/unschedule can return 409 when the same dedup key is updated in parallel. */
  retryConflict?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  jitterSeconds?: () => number;
}

export class RecallRequestError extends Error {
  readonly url: string;
  readonly method: string;
  readonly status: number | null;

  constructor(message: string, details: { url: string; method: string; status: number | null }) {
    super(message);
    this.name = "RecallRequestError";
    this.url = details.url;
    this.method = details.method;
    this.status = details.status;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactOptions(options: RequestInit): string {
  const headers = new Headers(options.headers);
  if (headers.has("authorization")) headers.set("authorization", "[redacted]");
  if (headers.has("Authorization")) headers.set("Authorization", "[redacted]");
  const body = typeof options.body === "string" ? `[${options.body.length} bytes]` : options.body ? "[body]" : undefined;
  return JSON.stringify({
    method: options.method ?? "GET",
    headers: Object.fromEntries(headers.entries()),
    body,
  });
}

/**
 * Every Recall HTTP call goes through this helper.
 * 429 waits for Retry-After plus 1–5s jitter. 503 waits 10s plus jitter.
 * 507 waits 30s plus jitter. Calendar 409s wait with backoff when enabled.
 * Six attempts, then an error that does not include the Authorization header or body.
 */
export async function fetchWithRetry(args: FetchWithRetryArgs): Promise<Response> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleep = args.sleep ?? defaultSleep;
  const jitterSeconds = args.jitterSeconds ?? (() => Math.ceil(Math.random() * 5));
  const maxAttempts = args.maxAttempts ?? 6;
  const method = args.options.method ?? "GET";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(args.url, args.options);
    lastStatus = response.status;
    let waitFor: number | null = null;
    if (response.status === 429) {
      const header = response.headers.get("retry-after") ?? response.headers.get("Retry-After");
      waitFor = Number.parseInt(header || "0", 10);
      if (!Number.isFinite(waitFor) || waitFor < 0) waitFor = 0;
    } else if (response.status === 503) {
      waitFor = 10;
    } else if (response.status === 507) {
      waitFor = 30;
    } else if (response.status === 409 && args.retryConflict) {
      waitFor = 2 ** attempt;
    }

    if (waitFor === null) return response;
    if (attempt === maxAttempts) break;

    const delaySeconds = waitFor + jitterSeconds();
    console.warn(
      `Recall request retry status=${response.status} attempt=${attempt} waitSeconds=${delaySeconds} method=${method} url=${args.url}`,
    );
    await sleep(delaySeconds * 1000);
  }

  throw new RecallRequestError(
    `Max attempts (${maxAttempts}) reached while fetching ${method} ${args.url}. options=${redactOptions(args.options)}`,
    { url: args.url, method, status: lastStatus },
  );
}
