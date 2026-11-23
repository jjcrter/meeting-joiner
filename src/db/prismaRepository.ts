import { Prisma, PrismaClient } from "@prisma/client";
import { isRecordingRule } from "../domain/shouldRecord";
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

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asOverrides(value: Prisma.JsonValue | null): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overrides: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") overrides[key] = entry;
  }
  return overrides;
}

type BotRow = Prisma.BotGetPayload<Record<string, never>>;
type CalendarRow = Prisma.CalendarGetPayload<Record<string, never>>;
type EventRow = Prisma.CalendarEventGetPayload<Record<string, never>>;
type RecordingRow = Prisma.RecordingGetPayload<Record<string, never>>;
type TranscriptRow = Prisma.TranscriptGetPayload<Record<string, never>>;
type WebhookRow = Prisma.WebhookEventGetPayload<Record<string, never>>;
type UserRow = Prisma.UserGetPayload<Record<string, never>>;

function mapUser(row: UserRow): UserRecord {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt.toISOString() };
}

function mapBot(row: BotRow): BotRecord {
  return {
    id: row.id,
    recallBotId: row.recallBotId,
    meetingUrl: row.meetingUrl,
    platform: row.platform,
    botName: row.botName,
    joinAt: row.joinAt.toISOString(),
    source: row.source === "calendar" ? "calendar" : "manual",
    launchedByUserId: row.launchedByUserId,
    calendarEventId: row.calendarEventId,
    latestStatus: row.latestStatus,
    latestSubCode: row.latestSubCode,
    latestStatusAt: iso(row.latestStatusAt),
    transcriptEnabled: row.transcriptEnabled,
    chatNoticeEnabled: row.chatNoticeEnabled,
    createState:
      row.createState === "created" || row.createState === "failed" || row.createState === "uncertain"
        ? row.createState
        : "pending",
    createError: row.createError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRecording(row: RecordingRow): RecordingRecord {
  return {
    id: row.id,
    recallRecordingId: row.recallRecordingId,
    botId: row.botId,
    status: row.status,
    subCode: row.subCode,
    transcriptRequestedAt: iso(row.transcriptRequestedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapTranscript(row: TranscriptRow): TranscriptRecord {
  return {
    id: row.id,
    recallTranscriptId: row.recallTranscriptId,
    recordingId: row.recordingId,
    status: row.status,
    subCode: row.subCode,
    provider: row.provider,
    rawJson: row.rawJson,
    readableText: row.readableText,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapCalendar(row: CalendarRow): CalendarRecord {
  return {
    id: row.id,
    recallCalendarId: row.recallCalendarId,
    userId: row.userId,
    platform: row.platform,
    platformEmail: row.platformEmail,
    status: row.status,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapEvent(row: EventRow): CalendarEventRecord {
  return {
    recallEventId: row.recallEventId,
    calendarId: row.calendarId,
    icalUid: row.icalUid,
    title: row.title,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    meetingUrl: row.meetingUrl,
    meetingPlatform: row.meetingPlatform,
    isDeleted: row.isDeleted,
    shouldRecord: row.shouldRecord,
    recallBotIds: asStringArray(row.recallBotIds),
    raw: row.raw,
    scheduleError: row.scheduleError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWebhook(row: WebhookRow): WebhookRecord {
  const status = row.status;
  return {
    webhookId: row.webhookId,
    event: row.event,
    payload: row.payload,
    verified: row.verified,
    status: status === "processing" || status === "processed" || status === "failed" ? status : "queued",
    error: row.error,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: iso(row.processedAt),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class PrismaRepository implements Repository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertUser(input: { email: string; name?: string | null }): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    const row = await this.prisma.user.upsert({
      where: { email },
      create: { id: crypto.randomUUID(), email, name: input.name ?? null },
      update: { name: input.name ?? undefined },
    });
    return mapUser(row);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    return row ? mapUser(row) : null;
  }

  async createBot(input: BotRecord): Promise<BotRecord> {
    const row = await this.prisma.bot.create({
      data: {
        id: input.id,
        recallBotId: input.recallBotId,
        meetingUrl: input.meetingUrl,
        platform: input.platform,
        botName: input.botName,
        joinAt: new Date(input.joinAt),
        source: input.source,
        launchedByUserId: input.launchedByUserId,
        calendarEventId: input.calendarEventId,
        latestStatus: input.latestStatus,
        latestSubCode: input.latestSubCode,
        latestStatusAt: input.latestStatusAt ? new Date(input.latestStatusAt) : null,
        transcriptEnabled: input.transcriptEnabled,
        chatNoticeEnabled: input.chatNoticeEnabled,
        createState: input.createState,
        createError: input.createError,
      },
    });
    return mapBot(row);
  }

  async updateBot(id: string, patch: Partial<BotRecord>): Promise<BotRecord> {
    const row = await this.prisma.bot.update({
      where: { id },
      data: {
        recallBotId: patch.recallBotId,
        meetingUrl: patch.meetingUrl,
        platform: patch.platform,
        botName: patch.botName,
        joinAt: patch.joinAt ? new Date(patch.joinAt) : undefined,
        source: patch.source,
        launchedByUserId: patch.launchedByUserId,
        calendarEventId: patch.calendarEventId,
        latestStatus: patch.latestStatus,
        latestSubCode: patch.latestSubCode,
        latestStatusAt: patch.latestStatusAt ? new Date(patch.latestStatusAt) : patch.latestStatusAt,
        transcriptEnabled: patch.transcriptEnabled,
        chatNoticeEnabled: patch.chatNoticeEnabled,
        createState: patch.createState,
        createError: patch.createError,
      },
    });
    return mapBot(row);
  }

  async getBot(id: string): Promise<BotRecord | null> {
    const row = await this.prisma.bot.findUnique({ where: { id } });
    return row ? mapBot(row) : null;
  }

  async getBotByRecallId(recallBotId: string): Promise<BotRecord | null> {
    const row = await this.prisma.bot.findUnique({ where: { recallBotId } });
    return row ? mapBot(row) : null;
  }

  async listBots(): Promise<BotRecord[]> {
    const rows = await this.prisma.bot.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(mapBot);
  }

  async addStatusEvent(input: StatusEventRecord): Promise<{ inserted: boolean }> {
    const existing = await this.prisma.botStatusEvent.findFirst({
      where: {
        botId: input.botId,
        code: input.code,
        subCode: input.subCode,
        recallUpdatedAt: new Date(input.recallUpdatedAt),
      },
    });
    if (existing) return { inserted: false };
    try {
      await this.prisma.botStatusEvent.create({
        data: {
          id: input.id,
          botId: input.botId,
          code: input.code,
          subCode: input.subCode,
          recallUpdatedAt: new Date(input.recallUpdatedAt),
        },
      });
      return { inserted: true };
    } catch (error) {
      if (isUniqueViolation(error)) return { inserted: false };
      throw error;
    }
  }

  async listStatusEvents(botId: string): Promise<StatusEventRecord[]> {
    const rows = await this.prisma.botStatusEvent.findMany({
      where: { botId },
      orderBy: { recallUpdatedAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      botId: row.botId,
      code: row.code,
      subCode: row.subCode,
      recallUpdatedAt: row.recallUpdatedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
    }));
  }

  async upsertRecording(input: RecordingRecord): Promise<RecordingRecord> {
    const row = await this.prisma.recording.upsert({
      where: { recallRecordingId: input.recallRecordingId },
      create: {
        id: input.id,
        recallRecordingId: input.recallRecordingId,
        botId: input.botId,
        status: input.status,
        subCode: input.subCode,
        transcriptRequestedAt: input.transcriptRequestedAt ? new Date(input.transcriptRequestedAt) : null,
      },
      update: {
        status: input.status,
        subCode: input.subCode,
        botId: input.botId,
      },
    });
    return mapRecording(row);
  }

  async getRecordingByRecallId(recallRecordingId: string): Promise<RecordingRecord | null> {
    const row = await this.prisma.recording.findUnique({ where: { recallRecordingId } });
    return row ? mapRecording(row) : null;
  }

  async listRecordingsForBot(botId: string): Promise<RecordingRecord[]> {
    const rows = await this.prisma.recording.findMany({ where: { botId }, orderBy: { createdAt: "asc" } });
    return rows.map(mapRecording);
  }

  async claimTranscriptRequest(recordingId: string): Promise<boolean> {
    const result = await this.prisma.recording.updateMany({
      where: { id: recordingId, transcriptRequestedAt: null },
      data: { transcriptRequestedAt: new Date() },
    });
    return result.count === 1;
  }

  async releaseTranscriptClaim(recordingId: string): Promise<void> {
    await this.prisma.recording.update({
      where: { id: recordingId },
      data: { transcriptRequestedAt: null },
    });
  }

  async upsertTranscript(input: TranscriptRecord): Promise<TranscriptRecord> {
    if (input.recallTranscriptId) {
      const row = await this.prisma.transcript.upsert({
        where: { recallTranscriptId: input.recallTranscriptId },
        create: {
          id: input.id,
          recallTranscriptId: input.recallTranscriptId,
          recordingId: input.recordingId,
          status: input.status,
          subCode: input.subCode,
          provider: input.provider,
          rawJson: input.rawJson === undefined ? undefined : (input.rawJson as Prisma.InputJsonValue),
          readableText: input.readableText,
        },
        update: {
          status: input.status,
          subCode: input.subCode,
          provider: input.provider,
          rawJson: input.rawJson === undefined ? undefined : (input.rawJson as Prisma.InputJsonValue),
          readableText: input.readableText,
        },
      });
      return mapTranscript(row);
    }
    const row = await this.prisma.transcript.create({
      data: {
        id: input.id,
        recordingId: input.recordingId,
        status: input.status,
        subCode: input.subCode,
        provider: input.provider,
        rawJson: input.rawJson === undefined ? undefined : (input.rawJson as Prisma.InputJsonValue),
        readableText: input.readableText,
      },
    });
    return mapTranscript(row);
  }

  async getTranscriptByRecallId(recallTranscriptId: string): Promise<TranscriptRecord | null> {
    const row = await this.prisma.transcript.findUnique({ where: { recallTranscriptId } });
    return row ? mapTranscript(row) : null;
  }

  async listTranscriptsForRecording(recordingId: string): Promise<TranscriptRecord[]> {
    const rows = await this.prisma.transcript.findMany({ where: { recordingId }, orderBy: { createdAt: "asc" } });
    return rows.map(mapTranscript);
  }

  async insertWebhook(input: WebhookRecord): Promise<{ inserted: boolean; row: WebhookRecord }> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          webhookId: input.webhookId,
          event: input.event,
          payload: input.payload as Prisma.InputJsonValue,
          verified: input.verified,
          status: input.status,
        },
      });
      return { inserted: true, row: mapWebhook(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.webhookEvent.findUnique({ where: { webhookId: input.webhookId } });
      if (!existing) throw error;
      return { inserted: false, row: mapWebhook(existing) };
    }
  }

  async getWebhook(webhookId: string): Promise<WebhookRecord | null> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { webhookId } });
    return row ? mapWebhook(row) : null;
  }

  async markWebhook(webhookId: string, status: WebhookRecord["status"], error?: string | null): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { webhookId },
      data: {
        status,
        error: error ?? null,
        processedAt: status === "processed" || status === "failed" ? new Date() : undefined,
      },
    });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.prisma.webhookEvent.delete({ where: { webhookId } }).catch(() => undefined);
  }

  async lastWebhookReceivedAt(): Promise<string | null> {
    const row = await this.prisma.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" } });
    return row ? row.receivedAt.toISOString() : null;
  }

  async upsertCalendar(input: CalendarRecord): Promise<CalendarRecord> {
    const row = await this.prisma.calendar.upsert({
      where: { recallCalendarId: input.recallCalendarId },
      create: {
        id: input.id,
        recallCalendarId: input.recallCalendarId,
        userId: input.userId,
        platform: input.platform,
        platformEmail: input.platformEmail,
        status: input.status,
        lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
      },
      update: {
        userId: input.userId,
        platform: input.platform,
        platformEmail: input.platformEmail,
        status: input.status,
        lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
      },
    });
    return mapCalendar(row);
  }

  async getCalendarForUser(userId: string): Promise<CalendarRecord | null> {
    const rows = await this.prisma.calendar.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    const row = rows.find((item) => item.status !== "disconnected") ?? rows[0];
    return row ? mapCalendar(row) : null;
  }

  async getCalendarByRecallId(recallCalendarId: string): Promise<CalendarRecord | null> {
    const row = await this.prisma.calendar.findUnique({ where: { recallCalendarId } });
    return row ? mapCalendar(row) : null;
  }

  async updateCalendar(id: string, patch: Partial<CalendarRecord>): Promise<CalendarRecord> {
    const row = await this.prisma.calendar.update({
      where: { id },
      data: {
        status: patch.status,
        platformEmail: patch.platformEmail,
        lastSyncedAt: patch.lastSyncedAt ? new Date(patch.lastSyncedAt) : patch.lastSyncedAt,
        userId: patch.userId,
      },
    });
    return mapCalendar(row);
  }

  async upsertCalendarEvent(input: CalendarEventRecord): Promise<CalendarEventRecord> {
    const row = await this.prisma.calendarEvent.upsert({
      where: { recallEventId: input.recallEventId },
      create: {
        recallEventId: input.recallEventId,
        calendarId: input.calendarId,
        icalUid: input.icalUid,
        title: input.title,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        meetingUrl: input.meetingUrl,
        meetingPlatform: input.meetingPlatform,
        isDeleted: input.isDeleted,
        shouldRecord: input.shouldRecord,
        recallBotIds: input.recallBotIds,
        raw: (input.raw ?? {}) as Prisma.InputJsonValue,
        scheduleError: input.scheduleError,
      },
      update: {
        calendarId: input.calendarId,
        icalUid: input.icalUid,
        title: input.title,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        meetingUrl: input.meetingUrl,
        meetingPlatform: input.meetingPlatform,
        isDeleted: input.isDeleted,
        shouldRecord: input.shouldRecord,
        recallBotIds: input.recallBotIds,
        raw: (input.raw ?? {}) as Prisma.InputJsonValue,
        scheduleError: input.scheduleError,
      },
    });
    return mapEvent(row);
  }

  async getCalendarEvent(recallEventId: string): Promise<CalendarEventRecord | null> {
    const row = await this.prisma.calendarEvent.findUnique({ where: { recallEventId } });
    return row ? mapEvent(row) : null;
  }

  async listUpcomingEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]> {
    const horizon = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.calendarEvent.findMany({
      where: { calendarId, isDeleted: false, endTime: { gt: now }, startTime: { lt: horizon } },
      orderBy: { startTime: "asc" },
    });
    return rows.map(mapEvent);
  }

  async listFutureEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]> {
    const rows = await this.prisma.calendarEvent.findMany({
      where: { calendarId, isDeleted: false, startTime: { gt: now } },
      orderBy: { startTime: "asc" },
    });
    return rows.map(mapEvent);
  }

  async updateCalendarEvent(
    recallEventId: string,
    patch: Partial<CalendarEventRecord>,
  ): Promise<CalendarEventRecord> {
    const row = await this.prisma.calendarEvent.update({
      where: { recallEventId },
      data: {
        shouldRecord: patch.shouldRecord,
        recallBotIds: patch.recallBotIds,
        scheduleError: patch.scheduleError,
        isDeleted: patch.isDeleted,
        title: patch.title,
        meetingUrl: patch.meetingUrl,
        startTime: patch.startTime ? new Date(patch.startTime) : undefined,
        endTime: patch.endTime ? new Date(patch.endTime) : undefined,
      },
    });
    return mapEvent(row);
  }

  async getPrefs(userId: string): Promise<RecordingPrefRecord> {
    const row = await this.prisma.recordingPref.findUnique({ where: { userId } });
    if (!row) return { userId, rule: "manual", overrides: {} };
    return {
      userId: row.userId,
      rule: isRecordingRule(row.rule) ? row.rule : "manual",
      overrides: asOverrides(row.overrides),
    };
  }

  async savePrefs(input: RecordingPrefRecord): Promise<RecordingPrefRecord> {
    const row = await this.prisma.recordingPref.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, rule: input.rule, overrides: input.overrides },
      update: { rule: input.rule, overrides: input.overrides },
    });
    return {
      userId: row.userId,
      rule: isRecordingRule(row.rule) ? row.rule : "manual",
      overrides: asOverrides(row.overrides),
    };
  }
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
