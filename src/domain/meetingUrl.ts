export type MeetingPlatform = "zoom" | "google_meet" | "microsoft_teams" | "webex";

const PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
  webex: "Webex",
};

export function platformLabel(platform: string): string {
  if (platform in PLATFORM_LABELS) return PLATFORM_LABELS[platform as MeetingPlatform];
  return platform;
}

function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function parseMeetingUrl(input: string): { meetingUrl: string; platform: MeetingPlatform } {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MeetingUrlError("Enter a full Zoom, Google Meet, Microsoft Teams, or Webex URL.");
  }
  if (url.protocol !== "https:") {
    throw new MeetingUrlError("Meeting URLs must start with https.");
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (hostMatches(host, "zoom.us")) {
    if (!/^\/(j|my|s|w)\//.test(path)) {
      throw new MeetingUrlError("That Zoom link is missing the meeting path. Use a join link such as https://zoom.us/j/...");
    }
    return { meetingUrl: url.toString(), platform: "zoom" };
  }
  if (host === "meet.google.com") {
    if (!/^\/[a-z0-9-]+$/i.test(path)) {
      throw new MeetingUrlError("That Google Meet link should look like https://meet.google.com/abc-defg-hij.");
    }
    return { meetingUrl: url.toString(), platform: "google_meet" };
  }
  if (hostMatches(host, "teams.microsoft.com") || host === "teams.live.com") {
    if (path.length < 2) {
      throw new MeetingUrlError("That Teams link is missing the meeting path.");
    }
    return { meetingUrl: url.toString(), platform: "microsoft_teams" };
  }
  if (hostMatches(host, "webex.com")) {
    if (!/^\/(meet|join|wbxmjs|start)\b/i.test(path) && !path.includes("j.php")) {
      throw new MeetingUrlError("That Webex link should be a meet or join URL.");
    }
    return { meetingUrl: url.toString(), platform: "webex" };
  }
  throw new MeetingUrlError("Use a Zoom, Google Meet, Microsoft Teams, or Webex meeting URL.");
}

export class MeetingUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingUrlError";
  }
}
