export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status})`, response.status);
  return payload as T;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Bot {
  id: string;
  recallBotId: string | null;
  meetingUrl: string;
  platform: string;
  botName: string;
  joinAt: string;
  source: "manual" | "calendar";
  latestStatus: string;
  latestSubCode: string | null;
  transcriptEnabled: boolean;
  chatNoticeEnabled: boolean;
  createState: string;
  createError: string | null;
  createdAt: string;
}

export interface StatusEvent {
  id: string;
  code: string;
  subCode: string | null;
  recallUpdatedAt: string;
}

export interface Transcript {
  id: string;
  status: string;
  subCode: string | null;
  readableText: string | null;
  provider: string | null;
}

export interface CalendarConnection {
  id: string;
  platformEmail: string;
  status: string;
  lastSyncedAt: string | null;
}

export interface CalendarEvent {
  recallEventId: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  meetingPlatform: string | null;
  shouldRecord: boolean;
  recallBotIds: string[];
  scheduleError: string | null;
  icalUid: string;
}

export function formatEastern(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    zoom: "Zoom",
    google_meet: "Google Meet",
    microsoft_teams: "Microsoft Teams",
    webex: "Webex",
  };
  return labels[platform] ?? platform;
}
