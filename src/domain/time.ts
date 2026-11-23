const EASTERN = "America/New_York";

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallParts(date: Date, timeZone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** Convert a `YYYY-MM-DDTHH:mm` wall time in America/New_York to a UTC Date. */
export function easternWallTimeToUtc(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) {
    throw new Error("Enter a date and time as YYYY-MM-DDTHH:mm in Eastern Time.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error("That Eastern Time value is not a real date.");
  }
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const seen = wallParts(new Date(utc), EASTERN);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const diff = desired - seenUtc;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

export function formatEastern(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatRelativeClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}
