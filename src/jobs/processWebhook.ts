import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import { parseTranscriptDownload, readableTranscriptText } from "../domain/transcript";
import type { BotRecord, Repository } from "../db/types";
import type { WebhookJob } from "../queue/types";
import { RecallApiError, RecallClient, transcriptDownloadUrlFromBot } from "../recall/client";
import { syncRecallEvents } from "../services/calendar";

interface ProcessorDeps {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  now?: () => Date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataOf(bot: Record<string, unknown> | null): Record<string, unknown> {
  const metadata = asRecord(bot?.metadata);
  return metadata ?? {};
}

export function createWebhookProcessor(deps: ProcessorDeps): (job: WebhookJob) => Promise<void> {
  return async (job) => {
    const row = await deps.repo.getWebhook(job.webhookId);
    if (!row || row.status === "processed") return;
    await deps.repo.markWebhook(job.webhookId, "processing", null);
    try {
      await dispatch(deps, row.event, row.payload);
      await deps.repo.markWebhook(job.webhookId, "processed", null);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed.";
      await deps.repo.markWebhook(job.webhookId, "failed", message);
      throw error;
    }
  };
}

async function dispatch(deps: ProcessorDeps, event: string, payload: unknown): Promise<void> {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (event.startsWith("bot.")) {
    await handleBotStatus(deps, event, data);
    return;
  }
  if (event === "recording.done" || event === "recording.failed") {
    await handleRecording(deps, event, data);
    return;
  }
  if (event === "transcript.done" || event === "transcript.failed") {
    await handleTranscript(deps, event, data);
    return;
  }
  if (event === "calendar.sync_events") {
    await handleCalendarSync(deps, data);
    return;
  }
  if (event === "calendar.update") {
    await handleCalendarUpdate(deps, data);
    return;
  }
  console.info(`Recall webhook ignored event=${event}`);
}

async function handleBotStatus(deps: ProcessorDeps, event: string, data: Record<string, unknown> | null): Promise<void> {
  const inner = asRecord(data?.data);
  const bot = asRecord(data?.bot);
  const recallBotId = readString(bot?.id);
  if (!recallBotId) throw new Error(`Webhook ${event} did not include a bot id.`);
  const code = readString(inner?.code) ?? event.replace(/^bot\./, "");
  const subCode = inner && "sub_code" in inner && inner.sub_code != null ? String(inner.sub_code) : null;
  const updatedAt = readString(inner?.updated_at) ?? new Date().toISOString();
  const local = await ensureBot(deps, recallBotId, metadataOf(bot));
  const inserted = await deps.repo.addStatusEvent({
    id: randomUUID(),
    botId: local.id,
    code,
    subCode,
    recallUpdatedAt: updatedAt,
    receivedAt: new Date().toISOString(),
  });
  if (!inserted) return;
  if (!local.latestStatusAt || new Date(updatedAt).getTime() >= new Date(local.latestStatusAt).getTime()) {
    await deps.repo.updateBot(local.id, {
      latestStatus: code,
      latestSubCode: subCode,
      latestStatusAt: updatedAt,
      recallBotId,
    });
  }
}

async function ensureBot(
  deps: ProcessorDeps,
  recallBotId: string,
  metadata: Record<string, unknown>,
): Promise<BotRecord> {
  const byRecall = await deps.repo.getBotByRecallId(recallBotId);
  if (byRecall) return byRecall;
  const appBotId = readString(metadata.app_bot_id);
  if (appBotId) {
    const byApp = await deps.repo.getBot(appBotId);
    if (byApp) {
      return deps.repo.updateBot(byApp.id, { recallBotId, createState: "created" });
    }
  }
  const now = new Date().toISOString();
  const transcriptEnabled = metadata.transcript_enabled !== "false";
  return deps.repo.createBot({
    id: appBotId ?? randomUUID(),
    recallBotId,
    meetingUrl: "unknown",
    platform: "unknown",
    botName: deps.config.botName,
    joinAt: now,
    source: metadata.source === "calendar" ? "calendar" : "manual",
    launchedByUserId: null,
    calendarEventId: readString(metadata.calendar_event_id),
    latestStatus: "scheduled",
    latestSubCode: null,
    latestStatusAt: null,
    transcriptEnabled,
    chatNoticeEnabled: false,
    createState: "created",
    createError: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function handleRecording(deps: ProcessorDeps, event: string, data: Record<string, unknown> | null): Promise<void> {
  const inner = asRecord(data?.data);
  const recording = asRecord(data?.recording);
  const bot = asRecord(data?.bot);
  const recordingId = readString(recording?.id);
  const recallBotId = readString(bot?.id);
  if (!recordingId || !recallBotId) throw new Error(`${event} is missing a recording id or bot id.`);
  const localBot = await ensureBot(deps, recallBotId, metadataOf(bot));
  const subCode = inner && inner.sub_code != null ? String(inner.sub_code) : null;
  const stored = await deps.repo.upsertRecording({
    id: randomUUID(),
    recallRecordingId: recordingId,
    botId: localBot.id,
    status: event === "recording.done" ? "done" : "failed",
    subCode,
    transcriptRequestedAt: null,
    createdAt: new Date().toISOString(),
  });
  if (event !== "recording.done" || !localBot.transcriptEnabled) return;
  const claimed = await deps.repo.claimTranscriptRequest(stored.id);
  if (!claimed) return;
  try {
    const transcript = await deps.recall.createAsyncTranscript(recordingId);
    await deps.repo.upsertTranscript({
      id: randomUUID(),
      recallTranscriptId: transcript.id,
      recordingId: stored.id,
      status: "processing",
      subCode: null,
      provider: "recallai_async",
      rawJson: null,
      readableText: null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    await deps.repo.releaseTranscriptClaim(stored.id);
    throw error;
  }
}

async function handleTranscript(deps: ProcessorDeps, event: string, data: Record<string, unknown> | null): Promise<void> {
  const inner = asRecord(data?.data);
  const transcript = asRecord(data?.transcript);
  const recording = asRecord(data?.recording);
  const bot = asRecord(data?.bot);
  const transcriptId = readString(transcript?.id);
  const recordingId = readString(recording?.id);
  const recallBotId = readString(bot?.id);
  if (!transcriptId || !recordingId) throw new Error(`${event} is missing a transcript id or recording id.`);
  const localBot = recallBotId ? await ensureBot(deps, recallBotId, metadataOf(bot)) : null;
  let storedRecording = await deps.repo.getRecordingByRecallId(recordingId);
  if (!storedRecording) {
    if (!localBot) throw new Error(`${event} arrived before the recording's bot was known.`);
    storedRecording = await deps.repo.upsertRecording({
      id: randomUUID(),
      recallRecordingId: recordingId,
      botId: localBot.id,
      status: "done",
      subCode: null,
      transcriptRequestedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }
  const subCode = inner && inner.sub_code != null ? String(inner.sub_code) : null;
  if (event === "transcript.failed") {
    await deps.repo.upsertTranscript({
      id: randomUUID(),
      recallTranscriptId: transcriptId,
      recordingId: storedRecording.id,
      status: "failed",
      subCode,
      provider: "recallai_async",
      rawJson: null,
      readableText: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const artifact = await deps.recall.getTranscript(transcriptId);
  let downloadUrl = artifact.downloadUrl;
  if (!downloadUrl && recallBotId) {
    const botPayload = await deps.recall.getBot(recallBotId);
    downloadUrl = transcriptDownloadUrlFromBot(botPayload, recordingId);
  }
  if (!downloadUrl) throw new Error("Transcript is done but Recall did not provide a download URL.");
  const downloaded = await deps.recall.downloadJson(downloadUrl);
  const parts = parseTranscriptDownload(downloaded);
  await deps.repo.upsertTranscript({
    id: randomUUID(),
    recallTranscriptId: transcriptId,
    recordingId: storedRecording.id,
    status: "done",
    subCode: null,
    provider: "recallai_async",
    rawJson: downloaded,
    readableText: readableTranscriptText(parts),
    createdAt: new Date().toISOString(),
  });
}

async function handleCalendarSync(deps: ProcessorDeps, data: Record<string, unknown> | null): Promise<void> {
  const calendarId = readString(data?.calendar_id);
  const lastUpdated = readString(data?.last_updated_ts);
  if (!calendarId || !lastUpdated) throw new Error("calendar.sync_events is missing calendar_id or last_updated_ts.");
  const calendar = await deps.repo.getCalendarByRecallId(calendarId);
  if (!calendar) throw new Error(`No local calendar for Recall calendar ${calendarId}.`);
  const user = await deps.repo.getUser(calendar.userId);
  if (!user) throw new Error(`Calendar ${calendarId} has no user.`);
  const prefs = await deps.repo.getPrefs(user.id);
  await syncRecallEvents({
    repo: deps.repo,
    recall: deps.recall,
    config: deps.config,
    jpegBase64: deps.jpegBase64,
    calendar,
    user,
    prefs,
    updatedAtGte: lastUpdated,
    now: deps.now?.(),
  });
}

async function handleCalendarUpdate(deps: ProcessorDeps, data: Record<string, unknown> | null): Promise<void> {
  const calendarId = readString(data?.calendar_id);
  if (!calendarId) throw new Error("calendar.update is missing calendar_id.");
  const local = await deps.repo.getCalendarByRecallId(calendarId);
  if (!local) return;
  try {
    const remote = await deps.recall.getCalendar(calendarId);
    await deps.repo.updateCalendar(local.id, {
      status: remote.status ?? local.status,
      platformEmail: remote.platform_email ?? local.platformEmail,
    });
  } catch (error) {
    if (error instanceof RecallApiError && error.status === 404) {
      await deps.repo.updateCalendar(local.id, { status: "disconnected" });
      return;
    }
    throw error;
  }
}
