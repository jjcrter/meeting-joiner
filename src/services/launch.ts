import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import { manualCreateBody, type BotMetadata } from "../domain/botConfig";
import { MeetingUrlError, parseMeetingUrl } from "../domain/meetingUrl";
import { easternWallTimeToUtc } from "../domain/time";
import type { Repository } from "../db/types";
import type { BotRecord } from "../db/types";
import { RecallApiError, RecallClient } from "../recall/client";
import { RecallRequestError } from "../recall/fetchWithRetry";

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

export async function launchBot(deps: {
  repo: Repository;
  recall: RecallClient;
  config: AppConfig;
  jpegBase64: string;
  userId: string;
  userEmail: string;
  meetingUrl: string;
  botName?: string;
  joinAt?: string;
  joinAtEastern?: string;
  transcriptEnabled?: boolean;
  chatNoticeEnabled?: boolean;
  now?: Date;
}): Promise<BotRecord> {
  let parsed: { meetingUrl: string; platform: ReturnType<typeof parseMeetingUrl>["platform"] };
  try {
    parsed = parseMeetingUrl(deps.meetingUrl);
  } catch (error) {
    if (error instanceof MeetingUrlError) throw new LaunchError(error.message);
    throw error;
  }

  const now = deps.now ?? new Date();
  let joinAt: Date;
  if (deps.joinAtEastern) {
    try {
      joinAt = easternWallTimeToUtc(deps.joinAtEastern);
    } catch (error) {
      throw new LaunchError(error instanceof Error ? error.message : "Invalid Eastern Time.");
    }
  } else if (deps.joinAt) {
    joinAt = new Date(deps.joinAt);
  } else {
    joinAt = new Date(now.getTime() + 5_000);
  }
  if (Number.isNaN(joinAt.getTime())) throw new LaunchError("Join time is not a valid date.");
  if (joinAt.getTime() < now.getTime() - 60_000) {
    throw new LaunchError("Join time is in the past. Pick a future Eastern Time or choose Join now.");
  }

  const transcriptEnabled = deps.transcriptEnabled !== false;
  const chatNoticeEnabled = deps.chatNoticeEnabled === true;
  const id = randomUUID();
  const metadata: BotMetadata = {
    app_bot_id: id,
    launched_by: deps.userEmail,
    source: "manual",
    transcript_enabled: transcriptEnabled ? "true" : "false",
  };
  const created = await deps.repo.createBot({
    id,
    recallBotId: null,
    meetingUrl: parsed.meetingUrl,
    platform: parsed.platform,
    botName: deps.botName?.trim() || deps.config.botName,
    joinAt: joinAt.toISOString(),
    source: "manual",
    launchedByUserId: deps.userId,
    calendarEventId: null,
    latestStatus: "scheduled",
    latestSubCode: null,
    latestStatusAt: null,
    transcriptEnabled,
    chatNoticeEnabled,
    createState: "pending",
    createError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  const body = manualCreateBody({
    meetingUrl: parsed.meetingUrl,
    joinAt: joinAt.toISOString(),
    botName: created.botName,
    base64Jpeg: deps.jpegBase64,
    metadata,
    chatNotice: chatNoticeEnabled,
  });

  try {
    const result = await deps.recall.createBot(body);
    return deps.repo.updateBot(id, { recallBotId: result.id, createState: "created", createError: null });
  } catch (error) {
    if (error instanceof RecallApiError) {
      return deps.repo.updateBot(id, {
        createState: "failed",
        createError: error.message.slice(0, 500),
        latestStatus: "create_failed",
      });
    }
    const message =
      error instanceof RecallRequestError
        ? "Recall did not accept the bot after retries. It was not created again automatically."
        : "The bot request did not finish. It was not sent again, so a duplicate bot is not created.";
    return deps.repo.updateBot(id, {
      createState: "uncertain",
      createError: message,
      latestStatus: "create_uncertain",
    });
  }
}
