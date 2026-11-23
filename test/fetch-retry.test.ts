import { describe, expect, it } from "vitest";
import { fetchWithRetry, RecallRequestError } from "../src/recall/fetchWithRetry";

function scripted(statuses: Array<{ status: number; retryAfter?: string }>) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const next = statuses.shift() ?? { status: 200 };
    return new Response(next.status === 200 ? "ok" : "retry", {
      status: next.status,
      headers: next.retryAfter ? { "retry-after": next.retryAfter } : undefined,
    });
  };
  return { fetchImpl, calls };
}

describe("fetchWithRetry", () => {
  it("waits for Retry-After plus jitter on 429", async () => {
    const { fetchImpl, calls } = scripted([{ status: 429, retryAfter: "2" }, { status: 200 }]);
    const sleeps: number[] = [];
    const response = await fetchWithRetry({
      url: "https://us-west-2.recall.ai/api/v1/bot/",
      options: { method: "POST", headers: { authorization: "secret-key" }, body: "{}" },
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      jitterSeconds: () => 3,
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([5000]);
  });

  it("waits 10 seconds plus jitter on 503 and 30 seconds plus jitter on 507", async () => {
    const sleeps: number[] = [];
    const first = scripted([{ status: 503 }, { status: 200 }]);
    await fetchWithRetry({
      url: "https://us-west-2.recall.ai/api/v1/bot/",
      options: { method: "GET" },
      fetchImpl: first.fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      jitterSeconds: () => 1,
    });
    const second = scripted([{ status: 507 }, { status: 200 }]);
    await fetchWithRetry({
      url: "https://us-west-2.recall.ai/api/v1/bot/",
      options: { method: "GET" },
      fetchImpl: second.fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      jitterSeconds: () => 1,
    });
    expect(sleeps).toEqual([11000, 31000]);
  });

  it("retries calendar 409s and stops after six attempts without logging the key", async () => {
    const { fetchImpl } = scripted(Array.from({ length: 6 }, () => ({ status: 409 })));
    await expect(
      fetchWithRetry({
        url: "https://us-west-2.recall.ai/api/v2/calendar-events/evt/bot/",
        options: { method: "POST", headers: { authorization: "super-secret-key" }, body: "{\"deduplication_key\":\"x\"}" },
        fetchImpl,
        sleep: async () => undefined,
        jitterSeconds: () => 1,
        retryConflict: true,
      }),
    ).rejects.toThrow(RecallRequestError);
    try {
      await fetchWithRetry({
        url: "https://us-west-2.recall.ai/api/v2/calendar-events/evt/bot/",
        options: { method: "POST", headers: { authorization: "super-secret-key" }, body: "body-secret" },
        fetchImpl: scripted(Array.from({ length: 6 }, () => ({ status: 409 }))).fetchImpl,
        sleep: async () => undefined,
        jitterSeconds: () => 1,
        retryConflict: true,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-key");
      expect((error as Error).message).not.toContain("body-secret");
      expect((error as Error).message).toContain("Max attempts (6)");
    }
  });

  it("does not retry a normal 409", async () => {
    const { fetchImpl, calls } = scripted([{ status: 409 }]);
    const response = await fetchWithRetry({
      url: "https://us-west-2.recall.ai/api/v1/bot/",
      options: { method: "POST" },
      fetchImpl,
      sleep: async () => {
        throw new Error("should not sleep");
      },
    });
    expect(response.status).toBe(409);
    expect(calls).toHaveLength(1);
  });
});
