import { describe, expect, it } from "vitest";
import { deduplicationKey } from "../src/domain/dedup";
import { parseMeetingUrl } from "../src/domain/meetingUrl";
import { shouldRecord } from "../src/domain/shouldRecord";
import { easternWallTimeToUtc } from "../src/domain/time";
import { convertToReadableTranscript, readableTranscriptText } from "../src/domain/transcript";
import { containsForbiddenAddress } from "../src/domain/safety";

const now = new Date("2026-11-23T15:00:00.000Z");
const future = "2026-11-24T15:00:00.000Z";
const later = "2026-11-24T16:00:00.000Z";

describe("deduplication key", () => {
  it("stays start_time then meeting_url", () => {
    const url = "https://zoom.us/j/123";
    expect(deduplicationKey(future, url)).toBe(`${future}-${url}`);
    expect(deduplicationKey(future, url)).toBe(deduplicationKey(future, url));
  });
});

describe("shouldRecord", () => {
  const base = {
    isDeleted: false,
    meetingUrl: "https://zoom.us/j/1",
    startTime: future,
    endTime: later,
    icalUid: "series-1",
    raw: { attendees: [{ email: "client@example.com" }] },
    rule: "manual" as const,
    overrides: {},
    calendarEmail: "jj@gldnpr.com",
    now,
  };

  it("keeps the manual default off", () => {
    expect(shouldRecord(base)).toBe(false);
  });

  it("records a future linked event when the series is opted in", () => {
    expect(shouldRecord({ ...base, overrides: { "series-1": true } })).toBe(true);
  });

  it("skips past, deleted, and link-free events even when auto_all is on", () => {
    expect(shouldRecord({ ...base, rule: "auto_all", startTime: "2026-11-23T14:00:00.000Z" })).toBe(false);
    expect(shouldRecord({ ...base, rule: "auto_all", isDeleted: true })).toBe(false);
    expect(shouldRecord({ ...base, rule: "auto_all", meetingUrl: null })).toBe(false);
  });

  it("lets an opt-out override beat auto_all", () => {
    expect(shouldRecord({ ...base, rule: "auto_all", overrides: { "series-1": false } })).toBe(false);
  });

  it("records external meetings only when an attendee is outside the calendar domain", () => {
    expect(shouldRecord({ ...base, rule: "external_only" })).toBe(true);
    expect(
      shouldRecord({
        ...base,
        rule: "external_only",
        raw: { attendees: [{ email: "alex@gldnpr.com" }] },
      }),
    ).toBe(false);
  });
});

describe("meeting urls and time", () => {
  it("accepts the four meeting platforms and rejects everything else", () => {
    expect(parseMeetingUrl("https://us06web.zoom.us/j/123?pwd=abc").platform).toBe("zoom");
    expect(parseMeetingUrl("https://meet.google.com/abc-defg-hij").platform).toBe("google_meet");
    expect(parseMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3Aabc").platform).toBe("microsoft_teams");
    expect(parseMeetingUrl("https://gldn.webex.com/meet/jj").platform).toBe("webex");
    expect(() => parseMeetingUrl("https://example.com/meet")).toThrow(/Zoom/);
    expect(() => parseMeetingUrl("http://zoom.us/j/1")).toThrow(/https/);
  });

  it("converts Eastern wall time to UTC across daylight saving", () => {
    expect(easternWallTimeToUtc("2026-11-24T15:00").toISOString()).toBe("2026-11-24T20:00:00.000Z");
    expect(easternWallTimeToUtc("2026-07-15T15:00").toISOString()).toBe("2026-07-15T19:00:00.000Z");
  });

  it("refuses localhost in a Recall body", () => {
    expect(containsForbiddenAddress({ meeting_url: "https://zoom.us/j/1", note: "http://localhost:3000" })).toBe(true);
    expect(containsForbiddenAddress({ meeting_url: "https://zoom.us/j/1" })).toBe(false);
  });
});

describe("readable transcript", () => {
  it("groups consecutive words from the same speaker", () => {
    const parts = [
      {
        participant: { id: 1, name: "Jordan" },
        words: [
          { text: "Hello", start_timestamp: { relative: 1.2, absolute: null }, end_timestamp: { relative: 1.6, absolute: null } },
        ],
      },
      {
        participant: { id: 1, name: "Jordan" },
        words: [
          { text: "team.", start_timestamp: { relative: 1.7, absolute: null }, end_timestamp: { relative: 2.1, absolute: null } },
        ],
      },
      {
        participant: { id: 2, name: "Avery" },
        words: [
          { text: "Thanks.", start_timestamp: { relative: 3, absolute: null }, end_timestamp: { relative: 3.4, absolute: null } },
        ],
      },
    ];
    const readable = convertToReadableTranscript(parts);
    expect(readable.map((item) => item.speaker)).toEqual(["Jordan", "Avery"]);
    expect(readable[0].paragraph).toBe("Hello team.");
    expect(readableTranscriptText(parts)).toContain("Jordan (0:01)");
    expect(readableTranscriptText(parts)).toContain("Hello team.");
  });
});
