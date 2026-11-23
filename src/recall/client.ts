import { z } from "zod";
import { RECALL_API_BASE_URL } from "../config/env";
import { assertDownloadUrl, assertNoLocalhost, isUsWestRecallUrl } from "../domain/safety";
import { fetchWithRetry, RecallRequestError } from "./fetchWithRetry";

export interface RecallClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  jitterSeconds?: () => number;
}

const CalendarEventSchema = z.object({
  id: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  calendar_id: z.string().optional(),
  meeting_url: z.string().nullable().optional(),
  is_deleted: z.boolean().optional().default(false),
  ical_uid: z.string().nullable().optional(),
  meeting_platform: z.union([z.string(), z.null()]).optional(),
  raw: z.unknown().optional(),
  bots: z
    .array(
      z.object({
        bot_id: z.string(),
        start_time: z.string().optional(),
        deduplication_key: z.string().optional(),
        meeting_url: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type RecallCalendarEvent = z.infer<typeof CalendarEventSchema>;

const CalendarSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platform_email: z.string().nullable().optional(),
  oauth_email: z.string().nullable().optional(),
  status: z.string().optional(),
  status_changes: z
    .array(
      z.object({
        status: z.string(),
        created_at: z.string(),
      }),
    )
    .optional(),
});

export type RecallCalendar = z.infer<typeof CalendarSchema>;

const PageSchema = z.object({
  next: z.string().nullable().optional(),
  results: z.array(z.unknown()).optional(),
});

export class RecallApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Recall API returned ${status}: ${body}`);
    this.name = "RecallApiError";
    this.status = status;
    this.body = body;
  }
}

function redact(text: string, secrets: string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output.slice(0, 500);
}

export function calendarConnectionStatus(calendar: RecallCalendar): string {
  if (calendar.status) return calendar.status;
  const changes = [...(calendar.status_changes ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return changes[0]?.status ?? "connecting";
}

export class RecallClient {
  constructor(private readonly options: RecallClientOptions) {}

  private async send(
    method: string,
    url: string,
    body?: unknown,
    extra?: { retryConflict?: boolean; auth?: boolean },
  ): Promise<Response> {
    if (body !== undefined) assertNoLocalhost(body);
    const headers: Record<string, string> = { accept: "application/json" };
    if (extra?.auth !== false) headers.authorization = this.options.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";
    try {
      return await fetchWithRetry({
        url,
        options: {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        retryConflict: extra?.retryConflict,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
        jitterSeconds: this.options.jitterSeconds,
      });
    } catch (error) {
      if (error instanceof RecallRequestError) throw error;
      throw error;
    }
  }

  private async json<T>(response: Response, parse: (value: unknown) => T, secrets: string[] = []): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new RecallApiError(response.status, redact(text, [this.options.apiKey, ...secrets]));
    }
    if (!text) return parse({});
    return parse(JSON.parse(text) as unknown);
  }

  private secretFields(body: unknown): string[] {
    if (!body || typeof body !== "object") return [];
    const record = body as Record<string, unknown>;
    return ["oauth_client_secret", "oauth_refresh_token", "oauth_client_id"]
      .map((key) => record[key])
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  }

  private follow(next: string | null | undefined): string | null {
    if (!next) return null;
    const absolute = next.startsWith("/") ? new URL(next, RECALL_API_BASE_URL).toString() : next;
    if (!isUsWestRecallUrl(absolute)) {
      throw new Error("Refusing to follow a Recall pagination URL outside us-west-2.");
    }
    return absolute;
  }

  private url(path: string, query?: Record<string, string | undefined>): string {
    const target = new URL(path, RECALL_API_BASE_URL);
    if (target.hostname !== "us-west-2.recall.ai") {
      throw new Error("Refusing to call Recall outside us-west-2.");
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value) target.searchParams.set(key, value);
    }
    return target.toString();
  }

  async createBot(body: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.send("POST", this.url("/api/v1/bot/"), body);
    return this.json(response, (value) => z.object({ id: z.string() }).parse(value));
  }

  async getBot(id: string): Promise<unknown> {
    const response = await this.send("GET", this.url(`/api/v1/bot/${id}/`));
    return this.json(response, (value) => value);
  }

  async deleteBot(id: string): Promise<void> {
    const response = await this.send("DELETE", this.url(`/api/v1/bot/${id}/`));
    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new RecallApiError(response.status, redact(text, [this.options.apiKey]));
    }
  }

  async leaveCall(id: string): Promise<void> {
    const response = await this.send("POST", this.url(`/api/v1/bot/${id}/leave_call/`), {});
    if (!response.ok) {
      const text = await response.text();
      throw new RecallApiError(response.status, redact(text, [this.options.apiKey]));
    }
  }

  async createAsyncTranscript(recordingId: string): Promise<{ id: string }> {
    const response = await this.send("POST", this.url(`/api/v1/recording/${recordingId}/create_transcript/`), {
      provider: { recallai_async: { language_code: "auto" } },
      diarization: { use_separate_streams_when_available: true },
    });
    return this.json(response, (value) => z.object({ id: z.string() }).parse(value));
  }

  async getTranscript(id: string): Promise<{ id: string; downloadUrl: string | null }> {
    const response = await this.send("GET", this.url(`/api/v1/transcript/${id}/`));
    return this.json(response, (value) => {
      const parsed = z
        .object({
          id: z.string(),
          data: z.object({ download_url: z.string().nullable().optional() }).optional(),
        })
        .parse(value);
      return { id: parsed.id, downloadUrl: parsed.data?.download_url ?? null };
    });
  }

  async downloadJson(url: string): Promise<unknown> {
    assertDownloadUrl(url);
    const response = await this.send("GET", url, undefined, { auth: false });
    return this.json(response, (value) => value);
  }

  async listCalendars(query: Record<string, string | undefined>): Promise<RecallCalendar[]> {
    const calendars: RecallCalendar[] = [];
    let next: string | null = this.url("/api/v2/calendars/", query);
    for (let page = 0; page < 20 && next; page += 1) {
      const response = await this.send("GET", next);
      const parsed = await this.json(response, (value) => PageSchema.parse(value));
      for (const item of parsed.results ?? []) calendars.push(CalendarSchema.parse(item));
      next = this.follow(parsed.next);
    }
    return calendars;
  }

  async createCalendar(body: Record<string, unknown>): Promise<RecallCalendar> {
    const response = await this.send("POST", this.url("/api/v2/calendars/"), body);
    return this.json(response, (value) => CalendarSchema.parse(value), this.secretFields(body));
  }

  async getCalendar(id: string): Promise<RecallCalendar> {
    const response = await this.send("GET", this.url(`/api/v2/calendars/${id}/`));
    return this.json(response, (value) => CalendarSchema.parse(value));
  }

  async updateCalendar(id: string, body: Record<string, unknown>): Promise<RecallCalendar> {
    const response = await this.send("PATCH", this.url(`/api/v2/calendars/${id}/`), body);
    return this.json(response, (value) => CalendarSchema.parse(value), this.secretFields(body));
  }

  async deleteCalendar(id: string): Promise<void> {
    const response = await this.send("DELETE", this.url(`/api/v2/calendars/${id}/`));
    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new RecallApiError(response.status, redact(text, [this.options.apiKey]));
    }
  }

  async listCalendarEvents(calendarId: string, updatedAtGte?: string): Promise<RecallCalendarEvent[]> {
    const events: RecallCalendarEvent[] = [];
    let next: string | null = this.url("/api/v2/calendar-events/", {
      calendar_id: calendarId,
      updated_at__gte: updatedAtGte,
    });
    for (let page = 0; page < 50 && next; page += 1) {
      const response = await this.send("GET", next);
      const parsed = await this.json(response, (value) => PageSchema.parse(value));
      for (const item of parsed.results ?? []) events.push(CalendarEventSchema.parse(item));
      next = this.follow(parsed.next);
    }
    return events;
  }

  async scheduleEventBot(eventId: string, body: Record<string, unknown>): Promise<RecallCalendarEvent> {
    const response = await this.send("POST", this.url(`/api/v2/calendar-events/${eventId}/bot/`), body, {
      retryConflict: true,
    });
    return this.json(response, (value) => CalendarEventSchema.parse(value));
  }

  async unscheduleEventBot(eventId: string): Promise<RecallCalendarEvent | null> {
    const response = await this.send("DELETE", this.url(`/api/v2/calendar-events/${eventId}/bot/`), undefined, {
      retryConflict: true,
    });
    if (response.status === 404) return null;
    return this.json(response, (value) => CalendarEventSchema.parse(value));
  }
}

export function transcriptDownloadUrlFromBot(bot: unknown, recordingId?: string): string | null {
  const parsed = z
    .object({
      recordings: z
        .array(
          z.object({
            id: z.string().optional(),
            media_shortcuts: z
              .object({
                transcript: z
                  .object({
                    data: z.object({ download_url: z.string().nullable().optional() }).optional(),
                  })
                  .nullable()
                  .optional(),
              })
              .nullable()
              .optional(),
          }),
        )
        .optional(),
    })
    .safeParse(bot);
  if (!parsed.success) return null;
  const recordings = parsed.data.recordings ?? [];
  const match = recordingId ? recordings.find((recording) => recording.id === recordingId) : recordings[0];
  return match?.media_shortcuts?.transcript?.data?.download_url ?? null;
}
