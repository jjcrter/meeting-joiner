/**
 * Deduplicate All, from the Calendar V2 scheduling guide:
 * `{start_time}-{meeting_url}`.
 * This string is part of the product contract. Changing it splits or duplicates bots
 * for events that already share a key. Do not reorder the parts.
 */
export function deduplicationKey(startTime: string, meetingUrl: string): string {
  return `${startTime}-${meetingUrl}`;
}
