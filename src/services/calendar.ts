import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import { calendarBotConfig, earlyJoinAt } from "../domain/botConfig";
import { deduplicationKey } from "../domain/dedup";
import { parseMeetingUrl } from "../domain/meetingUrl";
import { eventTitle, shouldRecord, type RecordingRule } from "../domain/shouldRecord";
import type { CalendarEventRecord, CalendarRecord, RecordingPrefRecord, Repository, UserRecord } from "../db/types";
import {
  calendarConnectionStatus,
  RecallApiError,
  RecallClient,
  type RecallCalendar,
  type RecallCalendarEvent,
} from "../recall/client";
import { RecallRequestError } from "../recall/fetchWithRetry";

function platformFor(url: string | null, reported: string | null | undefined): string {
  if (!url) return reported || "unknown";
  try {
    return parseMeetingUrl(url).platform;
  } catch {
    return reported || "unknown";
  }
}

function toStoredEvent(calendarId: string, event: RecallCalendarEvent, previous?: CalendarEventRecord | null): CalendarEventRecord {
  const meetingUrl = event.meeting_url ?? null;
  return {
    recallEventId: event.id,
    calendarId,
    icalUid: event.ical_uid ?? previous?.icalUid ?? "",
    title: eventTitle(event.raw),
    startTime: new Date(event.start_time).toISOString(),
    endTime: new Date(event.end_time).toISOString(),
    meetingUrl,
    meetingPlatform: platformFor(meetingUrl, event.meeting_platform),
    isDeleted: event.is_deleted,
    shouldRecord: previous?.shouldRecord ?? false,
    recallBotIds: event.bots.map((bot) => bot.bot_id),
    raw: event.raw ?? {},
    scheduleError: null,
    updatedAt: new Date().toISOString(),
  };
}

function safeError(error: unknown): string {
  if (error instanceof RecallApiError) return error.message.slice(0, 500);
  if (error instanceof RecallRequestError) return error.message.slice(0, 500);
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Calendar scheduling failed.";
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof RecallRequestError) return true;
  if (error instanceof RecallApiError && error.status >= 500) return true;
  return false;
}

export async function findOrConnectGoogleCalendar(deps: {
  recall: RecallClient;
  config: AppConfig;
  userId: string;
  email: string;
  refreshToken: string;
}): Promise<RecallCalendar> {
  if (!deps.config.googleClientId || !deps.config.googleClientSecret) {
    throw new Error("Google OAuth is not configured. See README section Google OAuth.");
  }
  const email = deps.email.toLowerCase();
  const existing = await findCalendar(deps.recall, email);
  const credentials = {
    platform: "google_calendar",
    oauth_client_id: deps.config.googleClientId,
    oauth_client_secret: deps.config.googleClientSecret,
    oauth_refresh_token: deps.refreshToken,
    oauth_email: email,
  };
  if (!existing) {
    return deps.recall.createCalendar({ ...credentials, metadata: { app_user_id: deps.userId } });
  }
  if (calendarConnectionStatus(existing) === "disconnected") {
    return deps.recall.updateCalendar(existing.id, credentials);
  }
  return existing;
}

async function findCalendar(recall: RecallClient, email: string): Promise<RecallCalendar | null> {
  const matches = async (query: Record<string, string>) => {
    const calendars = await recall.listCalendars(query);
    return (
      calendars.find((calendar) => (calendar.platform_email || calendar.oauth_email || "").toLowerCase() === email) ??
      null
    );
  };
  return (
    (await matches({ platform: "google_calendar", email })) ??
    (await matches({ platform: "google_calendar", platform_email: email }))
  );
}

export async function syncRecallEvents(deps: {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  calendar: CalendarRecord;
  user: UserRecord;
  prefs: RecordingPrefRecord;
  updatedAtGte?: string;
  now?: Date;
}): Promise<void> {
  const now = deps.now ?? new Date();
  const remote = await deps.recall.listCalendarEvents(deps.calendar.recallCalendarId, deps.updatedAtGte);
  const stored: CalendarEventRecord[] = [];
  for (const event of remote) {
    const previous = await deps.repo.getCalendarEvent(event.id);
    stored.push(await deps.repo.upsertCalendarEvent(toStoredEvent(deps.calendar.id, event, previous)));
  }
  stored.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  for (const event of stored) {
    await applyRecordingDecision({ ...deps, event, now });
  }
  await deps.repo.updateCalendar(deps.calendar.id, { lastSyncedAt: now.toISOString() });
}

export async function applyRecordingDecision(deps: {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  calendar: CalendarRecord;
  user: UserRecord;
  prefs: RecordingPrefRecord;
  event: CalendarEventRecord;
  now?: Date;
}): Promise<CalendarEventRecord> {
  const now = deps.now ?? new Date();
  const record = shouldRecord({
    isDeleted: deps.event.isDeleted,
    meetingUrl: deps.event.meetingUrl,
    startTime: deps.event.startTime,
    endTime: deps.event.endTime,
    icalUid: deps.event.icalUid,
    raw: deps.event.raw,
    rule: deps.prefs.rule,
    overrides: deps.prefs.overrides,
    calendarEmail: deps.calendar.platformEmail,
    now,
  });

  if (!record) {
    if (!deps.event.isDeleted && new Date(deps.event.startTime) > now && deps.event.recallBotIds.length > 0) {
      try {
        const updated = await deps.recall.unscheduleEventBot(deps.event.recallEventId);
        const botIds = updated?.bots.map((bot) => bot.bot_id) ?? [];
        await markBotsCancelled(deps.repo, deps.event.recallBotIds);
        return deps.repo.updateCalendarEvent(deps.event.recallEventId, {
          shouldRecord: false,
          recallBotIds: botIds,
          scheduleError: null,
        });
      } catch (error) {
        if (shouldRetry(error)) throw error;
        return deps.repo.updateCalendarEvent(deps.event.recallEventId, {
          shouldRecord: false,
          scheduleError: safeError(error),
        });
      }
    }
    return deps.repo.updateCalendarEvent(deps.event.recallEventId, {
      shouldRecord: false,
      scheduleError: null,
    });
  }

  const existingBot = deps.event.recallBotIds[0]
    ? await deps.repo.getBotByRecallId(deps.event.recallBotIds[0])
    : null;
  const appBotId = existingBot?.id ?? randomUUID();
  const joinAt = earlyJoinAt(deps.event.startTime, now);
  try {
    const updated = await deps.recall.scheduleEventBot(deps.event.recallEventId, {
      deduplication_key: deduplicationKey(deps.event.startTime, deps.event.meetingUrl!),
      bot_config: calendarBotConfig({
        joinAt,
        botName: deps.config.botName,
        base64Jpeg: deps.jpegBase64,
        cameraMode: deps.config.botCameraMode,
        cameraPageUrl: deps.config.botCameraPageUrl,
        metadata: {
          app_bot_id: appBotId,
          launched_by: deps.user.email,
          source: "calendar",
          transcript_enabled: "true",
          calendar_event_id: deps.event.recallEventId,
        },
      }),
    });
    const botIds = updated.bots.map((bot) => bot.bot_id);
    await ensureLocalBots({
      repo: deps.repo,
      event: { ...deps.event, meetingUrl: updated.meeting_url ?? deps.event.meetingUrl },
      user: deps.user,
      botIds,
      preferredId: appBotId,
      joinAt: joinAt ?? deps.event.startTime,
      botName: deps.config.botName,
    });
    return deps.repo.updateCalendarEvent(deps.event.recallEventId, {
      shouldRecord: true,
      recallBotIds: botIds,
      scheduleError: null,
      meetingUrl: updated.meeting_url ?? deps.event.meetingUrl,
      isDeleted: updated.is_deleted,
    });
  } catch (error) {
    if (shouldRetry(error)) throw error;
    return deps.repo.updateCalendarEvent(deps.event.recallEventId, {
      shouldRecord: false,
      scheduleError: safeError(error),
    });
  }
}

async function ensureLocalBots(args: {
  repo: Repository;
  event: CalendarEventRecord;
  user: UserRecord;
  botIds: string[];
  preferredId: string;
  joinAt: string;
  botName: string;
}): Promise<void> {
  for (const [index, recallBotId] of args.botIds.entries()) {
    const existing = await args.repo.getBotByRecallId(recallBotId);
    if (existing) {
      await args.repo.updateBot(existing.id, {
        calendarEventId: args.event.recallEventId,
        meetingUrl: args.event.meetingUrl ?? existing.meetingUrl,
        joinAt: args.joinAt,
      });
      continue;
    }
    const now = new Date().toISOString();
    await args.repo.createBot({
      id: index === 0 ? args.preferredId : randomUUID(),
      recallBotId,
      meetingUrl: args.event.meetingUrl ?? "",
      platform: args.event.meetingPlatform ?? "unknown",
      botName: args.botName,
      joinAt: args.joinAt,
      source: "calendar",
      launchedByUserId: args.user.id,
      calendarEventId: args.event.recallEventId,
      latestStatus: "scheduled",
      latestSubCode: null,
      latestStatusAt: null,
      transcriptEnabled: true,
      chatNoticeEnabled: false,
      createState: "created",
      createError: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function markBotsCancelled(repo: Repository, recallBotIds: string[]): Promise<void> {
  for (const recallBotId of recallBotIds) {
    const bot = await repo.getBotByRecallId(recallBotId);
    if (bot && (bot.latestStatus === "scheduled" || bot.latestStatus === "create_failed")) {
      await repo.updateBot(bot.id, { latestStatus: "cancelled" });
    }
  }
}

export async function setRecordingRule(deps: {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  user: UserRecord;
  calendar: CalendarRecord;
  rule: RecordingRule;
  now?: Date;
}): Promise<RecordingPrefRecord> {
  const current = await deps.repo.getPrefs(deps.user.id);
  const prefs = await deps.repo.savePrefs({ ...current, rule: deps.rule });
  const events = await deps.repo.listFutureEvents(deps.calendar.id, deps.now ?? new Date());
  for (const event of events) {
    await applyRecordingDecision({ ...deps, prefs, event, now: deps.now });
  }
  return prefs;
}

export async function setSeriesOverride(deps: {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  user: UserRecord;
  calendar: CalendarRecord;
  event: CalendarEventRecord;
  record: boolean;
  now?: Date;
}): Promise<void> {
  const now = deps.now ?? new Date();
  const current = await deps.repo.getPrefs(deps.user.id);
  const overrides = { ...current.overrides };
  if (deps.event.icalUid) overrides[deps.event.icalUid] = deps.record;
  const prefs = await deps.repo.savePrefs({ ...current, overrides });
  const related = deps.event.icalUid
    ? (await deps.repo.listFutureEvents(deps.calendar.id, now)).filter((event) => event.icalUid === deps.event.icalUid)
    : [deps.event];
  const targets = related.length > 0 ? related : [deps.event];
  for (const event of targets) {
    await applyRecordingDecision({ ...deps, prefs, event, now });
  }
}
