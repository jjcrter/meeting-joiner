import { automaticVideoOutput } from "./video";

export const CHAT_NOTICE_MESSAGE =
  "GLDN PR is recording this meeting for internal notes. The notetaker will not post again.";

export interface BotMetadata {
  app_bot_id: string;
  launched_by: string;
  source: "manual" | "calendar";
  transcript_enabled: "true" | "false";
  calendar_event_id?: string;
}

export function videoConfig(base64: string) {
  return automaticVideoOutput(base64);
}

export function manualCreateBody(input: {
  meetingUrl: string;
  joinAt: string;
  botName: string;
  base64Jpeg: string;
  metadata: BotMetadata;
  chatNotice: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    meeting_url: input.meetingUrl,
    join_at: input.joinAt,
    bot_name: input.botName,
    automatic_video_output: videoConfig(input.base64Jpeg),
    metadata: input.metadata,
  };
  if (input.chatNotice) {
    body.chat = {
      on_bot_join: {
        send_to: "everyone",
        message: CHAT_NOTICE_MESSAGE,
        pin: true,
      },
    };
  }
  return body;
}

/** Full calendar bot_config. meeting_url is left for Recall to fill from the event. */
export function calendarBotConfig(input: {
  joinAt: string | null;
  botName: string;
  base64Jpeg: string;
  metadata: BotMetadata;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    bot_name: input.botName,
    automatic_video_output: videoConfig(input.base64Jpeg),
    metadata: input.metadata,
  };
  if (input.joinAt) config.join_at = input.joinAt;
  return config;
}

/** Join two minutes early when that instant is still in the future. */
export function earlyJoinAt(startTime: string, now: Date): string | null {
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start) || start <= now.getTime()) return null;
  const early = start - 2 * 60 * 1000;
  const soonest = now.getTime() + 15_000;
  if (early > soonest) return new Date(early).toISOString();
  if (soonest < start) return new Date(soonest).toISOString();
  return null;
}
