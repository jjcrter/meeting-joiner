export type RecordingRule = "manual" | "auto_all" | "external_only";

export interface RecordDecisionInput {
  isDeleted: boolean;
  meetingUrl: string | null;
  startTime: string;
  endTime: string;
  icalUid: string;
  raw: unknown;
  rule: RecordingRule;
  /** ical_uid -> record. true forces on, false forces off. */
  overrides: Record<string, boolean>;
  calendarEmail: string;
  now: Date;
}

export function attendeeEmails(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const attendees = (raw as { attendees?: unknown }).attendees;
  if (!Array.isArray(attendees)) return [];
  const emails: string[] = [];
  for (const attendee of attendees) {
    if (!attendee || typeof attendee !== "object") continue;
    const email = (attendee as { email?: unknown }).email;
    if (typeof email === "string" && email.includes("@")) emails.push(email.trim().toLowerCase());
  }
  return emails;
}

export function eventTitle(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Untitled meeting";
  const record = raw as { summary?: unknown; subject?: unknown };
  if (typeof record.summary === "string" && record.summary.trim()) return record.summary.trim();
  if (typeof record.subject === "string" && record.subject.trim()) return record.subject.trim();
  return "Untitled meeting";
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function hasExternalAttendee(raw: unknown, calendarEmail: string): boolean {
  const domain = emailDomain(calendarEmail);
  if (!domain) return false;
  return attendeeEmails(raw).some((email) => emailDomain(email) !== domain);
}

/**
 * Connecting a calendar syncs events. It does not send a bot unless this returns true.
 * Default rule is `manual`: a person turns Record on for the series, or picks an auto rule.
 * Deleted, past, and link-free events are never scheduled.
 */
export function shouldRecord(input: RecordDecisionInput): boolean {
  if (input.isDeleted) return false;
  if (!input.meetingUrl) return false;
  if (new Date(input.startTime).getTime() <= input.now.getTime()) return false;
  if (new Date(input.endTime).getTime() <= input.now.getTime()) return false;

  const override = input.icalUid ? input.overrides[input.icalUid] : undefined;
  if (override === true) return true;
  if (override === false) return false;

  if (input.rule === "auto_all") return true;
  if (input.rule === "external_only") return hasExternalAttendee(input.raw, input.calendarEmail);
  return false;
}

export function isRecordingRule(value: string): value is RecordingRule {
  return value === "manual" || value === "auto_all" || value === "external_only";
}
