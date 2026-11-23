import { randomUUID } from "node:crypto";
import type { RecordingRule } from "../domain/shouldRecord";
import type {
  BotRecord,
  CalendarEventRecord,
  CalendarRecord,
  RecordingPrefRecord,
  RecordingRecord,
  Repository,
  StatusEventRecord,
  TranscriptRecord,
  UserRecord,
  WebhookRecord,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function statusKey(event: Pick<StatusEventRecord, "botId" | "code" | "subCode" | "recallUpdatedAt">): string {
  return `${event.botId}|${event.code}|${event.subCode ?? ""}|${event.recallUpdatedAt}`;
}

export class MemoryRepository implements Repository {
  private users = new Map<string, UserRecord>();
  private bots = new Map<string, BotRecord>();
  private statusEvents = new Map<string, StatusEventRecord>();
  private recordings = new Map<string, RecordingRecord>();
  private transcripts = new Map<string, TranscriptRecord>();
  private webhooks = new Map<string, WebhookRecord>();
  private calendars = new Map<string, CalendarRecord>();
  private events = new Map<string, CalendarEventRecord>();
  private prefs = new Map<string, RecordingPrefRecord>();

  async upsertUser(input: { email: string; name?: string | null }): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    const existing = [...this.users.values()].find((user) => user.email === email);
    if (existing) {
      existing.name = input.name ?? existing.name;
      return clone(existing);
    }
    const user: UserRecord = {
      id: randomUUID(),
      email,
      name: input.name ?? null,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return clone(user);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? clone(user) : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const user = [...this.users.values()].find((item) => item.email === email.toLowerCase());
    return user ? clone(user) : null;
  }

  async createBot(input: BotRecord): Promise<BotRecord> {
    this.bots.set(input.id, clone(input));
    return clone(input);
  }

  async updateBot(id: string, patch: Partial<BotRecord>): Promise<BotRecord> {
    const current = this.bots.get(id);
    if (!current) throw new Error(`Bot ${id} not found`);
    const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    this.bots.set(id, next);
    return clone(next);
  }

  async getBot(id: string): Promise<BotRecord | null> {
    const bot = this.bots.get(id);
    return bot ? clone(bot) : null;
  }

  async getBotByRecallId(recallBotId: string): Promise<BotRecord | null> {
    const bot = [...this.bots.values()].find((item) => item.recallBotId === recallBotId);
    return bot ? clone(bot) : null;
  }

  async listBots(): Promise<BotRecord[]> {
    return [...this.bots.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((bot) => clone(bot));
  }

  async addStatusEvent(input: StatusEventRecord): Promise<{ inserted: boolean }> {
    const key = statusKey(input);
    if (this.statusEvents.has(key)) return { inserted: false };
    this.statusEvents.set(key, clone(input));
    return { inserted: true };
  }

  async listStatusEvents(botId: string): Promise<StatusEventRecord[]> {
    return [...this.statusEvents.values()]
      .filter((event) => event.botId === botId)
      .sort((a, b) => (a.recallUpdatedAt < b.recallUpdatedAt ? -1 : 1))
      .map((event) => clone(event));
  }

  async upsertRecording(input: RecordingRecord): Promise<RecordingRecord> {
    const existing = [...this.recordings.values()].find((item) => item.recallRecordingId === input.recallRecordingId);
    if (existing) {
      const next = {
        ...existing,
        ...input,
        id: existing.id,
        transcriptRequestedAt: input.transcriptRequestedAt ?? existing.transcriptRequestedAt,
      };
      this.recordings.set(existing.id, next);
      return clone(next);
    }
    this.recordings.set(input.id, clone(input));
    return clone(input);
  }

  async getRecordingByRecallId(recallRecordingId: string): Promise<RecordingRecord | null> {
    const recording = [...this.recordings.values()].find((item) => item.recallRecordingId === recallRecordingId);
    return recording ? clone(recording) : null;
  }

  async listRecordingsForBot(botId: string): Promise<RecordingRecord[]> {
    return [...this.recordings.values()].filter((item) => item.botId === botId).map((item) => clone(item));
  }

  async claimTranscriptRequest(recordingId: string): Promise<boolean> {
    const recording = this.recordings.get(recordingId);
    if (!recording || recording.transcriptRequestedAt) return false;
    recording.transcriptRequestedAt = new Date().toISOString();
    return true;
  }

  async releaseTranscriptClaim(recordingId: string): Promise<void> {
    const recording = this.recordings.get(recordingId);
    if (recording) recording.transcriptRequestedAt = null;
  }

  async upsertTranscript(input: TranscriptRecord): Promise<TranscriptRecord> {
    const existing = input.recallTranscriptId
      ? [...this.transcripts.values()].find((item) => item.recallTranscriptId === input.recallTranscriptId)
      : [...this.transcripts.values()].find((item) => item.recordingId === input.recordingId && item.id === input.id);
    if (existing) {
      const next = { ...existing, ...input, id: existing.id };
      this.transcripts.set(existing.id, next);
      return clone(next);
    }
    this.transcripts.set(input.id, clone(input));
    return clone(input);
  }

  async getTranscriptByRecallId(recallTranscriptId: string): Promise<TranscriptRecord | null> {
    const transcript = [...this.transcripts.values()].find((item) => item.recallTranscriptId === recallTranscriptId);
    return transcript ? clone(transcript) : null;
  }

  async listTranscriptsForRecording(recordingId: string): Promise<TranscriptRecord[]> {
    return [...this.transcripts.values()]
      .filter((item) => item.recordingId === recordingId)
      .map((item) => clone(item));
  }

  async insertWebhook(input: WebhookRecord): Promise<{ inserted: boolean; row: WebhookRecord }> {
    const existing = this.webhooks.get(input.webhookId);
    if (existing) return { inserted: false, row: clone(existing) };
    this.webhooks.set(input.webhookId, clone(input));
    return { inserted: true, row: clone(input) };
  }

  async getWebhook(webhookId: string): Promise<WebhookRecord | null> {
    const row = this.webhooks.get(webhookId);
    return row ? clone(row) : null;
  }

  async markWebhook(webhookId: string, status: WebhookRecord["status"], error?: string | null): Promise<void> {
    const row = this.webhooks.get(webhookId);
    if (!row) return;
    row.status = status;
    row.error = error ?? null;
    if (status === "processed" || status === "failed") row.processedAt = new Date().toISOString();
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    this.webhooks.delete(webhookId);
  }

  async lastWebhookReceivedAt(): Promise<string | null> {
    const rows = [...this.webhooks.values()];
    if (rows.length === 0) return null;
    return rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))[0].receivedAt;
  }

  async upsertCalendar(input: CalendarRecord): Promise<CalendarRecord> {
    const existing = [...this.calendars.values()].find((item) => item.recallCalendarId === input.recallCalendarId);
    if (existing) {
      const next = { ...existing, ...input, id: existing.id, updatedAt: new Date().toISOString() };
      this.calendars.set(existing.id, next);
      return clone(next);
    }
    this.calendars.set(input.id, clone(input));
    return clone(input);
  }

  async getCalendarForUser(userId: string): Promise<CalendarRecord | null> {
    const calendars = [...this.calendars.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const connected = calendars.find((item) => item.status !== "disconnected") ?? calendars[0];
    return connected ? clone(connected) : null;
  }

  async getCalendarByRecallId(recallCalendarId: string): Promise<CalendarRecord | null> {
    const calendar = [...this.calendars.values()].find((item) => item.recallCalendarId === recallCalendarId);
    return calendar ? clone(calendar) : null;
  }

  async updateCalendar(id: string, patch: Partial<CalendarRecord>): Promise<CalendarRecord> {
    const current = this.calendars.get(id);
    if (!current) throw new Error(`Calendar ${id} not found`);
    const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    this.calendars.set(id, next);
    return clone(next);
  }

  async upsertCalendarEvent(input: CalendarEventRecord): Promise<CalendarEventRecord> {
    const existing = this.events.get(input.recallEventId);
    const next = existing
      ? { ...existing, ...input, recallEventId: existing.recallEventId, updatedAt: new Date().toISOString() }
      : { ...input, updatedAt: input.updatedAt || new Date().toISOString() };
    this.events.set(next.recallEventId, next);
    return clone(next);
  }

  async getCalendarEvent(recallEventId: string): Promise<CalendarEventRecord | null> {
    const event = this.events.get(recallEventId);
    return event ? clone(event) : null;
  }

  async listUpcomingEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]> {
    const horizon = now.getTime() + 28 * 24 * 60 * 60 * 1000;
    return [...this.events.values()]
      .filter((event) => {
        if (event.calendarId !== calendarId || event.isDeleted) return false;
        const start = new Date(event.startTime).getTime();
        const end = new Date(event.endTime).getTime();
        return end > now.getTime() && start < horizon;
      })
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1))
      .map((event) => clone(event));
  }

  async listFutureEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]> {
    return [...this.events.values()]
      .filter((event) => event.calendarId === calendarId && !event.isDeleted && new Date(event.startTime) > now)
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1))
      .map((event) => clone(event));
  }

  async updateCalendarEvent(
    recallEventId: string,
    patch: Partial<CalendarEventRecord>,
  ): Promise<CalendarEventRecord> {
    const current = this.events.get(recallEventId);
    if (!current) throw new Error(`Calendar event ${recallEventId} not found`);
    const next = { ...current, ...patch, recallEventId, updatedAt: new Date().toISOString() };
    this.events.set(recallEventId, next);
    return clone(next);
  }

  async getPrefs(userId: string): Promise<RecordingPrefRecord> {
    const existing = this.prefs.get(userId);
    if (existing) return clone(existing);
    const created: RecordingPrefRecord = { userId, rule: "manual" satisfies RecordingRule, overrides: {} };
    this.prefs.set(userId, created);
    return clone(created);
  }

  async savePrefs(input: RecordingPrefRecord): Promise<RecordingPrefRecord> {
    this.prefs.set(input.userId, clone(input));
    return clone(input);
  }
}
