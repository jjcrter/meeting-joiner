import type { RecordingRule } from "../domain/shouldRecord";

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface BotRecord {
  id: string;
  recallBotId: string | null;
  meetingUrl: string;
  platform: string;
  botName: string;
  joinAt: string;
  source: "manual" | "calendar";
  launchedByUserId: string | null;
  calendarEventId: string | null;
  latestStatus: string;
  latestSubCode: string | null;
  latestStatusAt: string | null;
  transcriptEnabled: boolean;
  chatNoticeEnabled: boolean;
  createState: "pending" | "created" | "failed" | "uncertain";
  createError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusEventRecord {
  id: string;
  botId: string;
  code: string;
  subCode: string | null;
  recallUpdatedAt: string;
  receivedAt: string;
}

export interface RecordingRecord {
  id: string;
  recallRecordingId: string;
  botId: string;
  status: string;
  subCode: string | null;
  transcriptRequestedAt: string | null;
  createdAt: string;
}

export interface TranscriptRecord {
  id: string;
  recallTranscriptId: string | null;
  recordingId: string;
  status: string;
  subCode: string | null;
  provider: string | null;
  rawJson: unknown;
  readableText: string | null;
  createdAt: string;
}

export interface CalendarRecord {
  id: string;
  recallCalendarId: string;
  userId: string;
  platform: string;
  platformEmail: string;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventRecord {
  recallEventId: string;
  calendarId: string;
  icalUid: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  meetingPlatform: string | null;
  isDeleted: boolean;
  shouldRecord: boolean;
  recallBotIds: string[];
  raw: unknown;
  scheduleError: string | null;
  updatedAt: string;
}

export interface RecordingPrefRecord {
  userId: string;
  rule: RecordingRule;
  overrides: Record<string, boolean>;
}

export interface WebhookRecord {
  webhookId: string;
  event: string;
  payload: unknown;
  verified: boolean;
  status: "queued" | "processing" | "processed" | "failed";
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface Repository {
  upsertUser(input: { email: string; name?: string | null }): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;

  createBot(input: BotRecord): Promise<BotRecord>;
  updateBot(id: string, patch: Partial<BotRecord>): Promise<BotRecord>;
  getBot(id: string): Promise<BotRecord | null>;
  getBotByRecallId(recallBotId: string): Promise<BotRecord | null>;
  listBots(): Promise<BotRecord[]>;

  addStatusEvent(input: StatusEventRecord): Promise<{ inserted: boolean }>;
  listStatusEvents(botId: string): Promise<StatusEventRecord[]>;

  upsertRecording(input: RecordingRecord): Promise<RecordingRecord>;
  getRecordingByRecallId(recallRecordingId: string): Promise<RecordingRecord | null>;
  listRecordingsForBot(botId: string): Promise<RecordingRecord[]>;
  claimTranscriptRequest(recordingId: string): Promise<boolean>;
  releaseTranscriptClaim(recordingId: string): Promise<void>;

  upsertTranscript(input: TranscriptRecord): Promise<TranscriptRecord>;
  getTranscriptByRecallId(recallTranscriptId: string): Promise<TranscriptRecord | null>;
  listTranscriptsForRecording(recordingId: string): Promise<TranscriptRecord[]>;

  insertWebhook(input: WebhookRecord): Promise<{ inserted: boolean; row: WebhookRecord }>;
  getWebhook(webhookId: string): Promise<WebhookRecord | null>;
  markWebhook(webhookId: string, status: WebhookRecord["status"], error?: string | null): Promise<void>;
  deleteWebhook(webhookId: string): Promise<void>;
  lastWebhookReceivedAt(): Promise<string | null>;

  upsertCalendar(input: CalendarRecord): Promise<CalendarRecord>;
  getCalendarForUser(userId: string): Promise<CalendarRecord | null>;
  getCalendarByRecallId(recallCalendarId: string): Promise<CalendarRecord | null>;
  updateCalendar(id: string, patch: Partial<CalendarRecord>): Promise<CalendarRecord>;

  upsertCalendarEvent(input: CalendarEventRecord): Promise<CalendarEventRecord>;
  getCalendarEvent(recallEventId: string): Promise<CalendarEventRecord | null>;
  listUpcomingEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]>;
  listFutureEvents(calendarId: string, now: Date): Promise<CalendarEventRecord[]>;
  updateCalendarEvent(recallEventId: string, patch: Partial<CalendarEventRecord>): Promise<CalendarEventRecord>;

  getPrefs(userId: string): Promise<RecordingPrefRecord>;
  savePrefs(input: RecordingPrefRecord): Promise<RecordingPrefRecord>;
}
