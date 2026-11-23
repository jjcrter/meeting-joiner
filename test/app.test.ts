import { afterEach, describe, expect, it } from "vitest";
import { deduplicationKey } from "../src/domain/dedup";
import { buildHarness, login, signedWebhook } from "./helpers";

const harnesses: Array<{ app: { close: () => Promise<void> } }> = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((item) => item.app.close()));
});

describe("meeting launch and webhooks", () => {
  it("launches through the API with video, join_at, and no chat, then stores the transcript", async () => {
    const downloads = new Map<string, unknown>();
    const harness = await buildHarness(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/api/v1/bot/")) {
        return json({ id: "recall-bot-1" }, 201);
      }
      if (method === "POST" && url.includes("/create_transcript/")) {
        return json({ id: "transcript-1" });
      }
      if (method === "GET" && url.includes("/api/v1/transcript/transcript-1")) {
        return json({ id: "transcript-1", data: { download_url: "https://files.example.com/transcript.json" } });
      }
      if (url === "https://files.example.com/transcript.json") {
        return json([
          {
            participant: { id: 10, name: "Jordan Lee" },
            words: [
              { text: "Thanks", start_timestamp: { relative: 4 }, end_timestamp: { relative: 4.4 } },
              { text: "everyone.", start_timestamp: { relative: 4.5 }, end_timestamp: { relative: 5 } },
            ],
          },
        ]);
      }
      downloads.set(url, method);
      return json({ id: "unused" });
    });
    harnesses.push(harness);
    const cookie = await login(harness.app);
    const launch = await harness.app.inject({
      method: "POST",
      url: "/api/bots",
      headers: { cookie },
      payload: { meetingUrl: "https://us06web.zoom.us/j/999111222" },
    });
    expect(launch.statusCode).toBe(201);
    const create = harness.calls.find((call) => call.method === "POST" && call.url.includes("/api/v1/bot/"));
    expect(create?.url.startsWith("https://us-west-2.recall.ai/")).toBe(true);
    expect(create?.authorization).toBe("test-recall-key");
    const body = create?.body as {
      meeting_url: string;
      join_at: string;
      bot_name: string;
      chat?: unknown;
      recording_config?: unknown;
      automatic_video_output?: unknown;
      output_media: { camera: { kind: string; config: { url: string } } };
      variant: Record<string, string>;
      metadata: { source: string };
    };
    expect(body.bot_name).toBe("GLDN PR Notetaker");
    expect(body.join_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.chat).toBeUndefined();
    expect(body.recording_config).toBeUndefined();
    expect(body.automatic_video_output).toBeUndefined();
    expect(body.metadata.source).toBe("manual");
    expect(body.output_media).toEqual({
      camera: { kind: "webpage", config: { url: "https://bot.gldnpr.test/bot-camera" } },
    });
    expect(body.variant).toEqual({
      zoom: "web_4_core",
      google_meet: "web_4_core",
      microsoft_teams: "web_4_core",
      webex: "web_4_core",
    });
    expect(JSON.stringify(body)).not.toMatch(/localhost|127\.0\.0\.1/);

    const botId = launch.json().bot.id as string;
    const recallBotId = "recall-bot-1";
    const sequence = [
      botEvent("bot.joining_call", "joining_call", recallBotId, "2026-11-23T18:00:00.000Z"),
      botEvent("bot.in_call_recording", "in_call_recording", recallBotId, "2026-11-23T18:01:00.000Z"),
      botEvent("bot.done", "done", recallBotId, "2026-11-23T18:20:00.000Z"),
      {
        event: "recording.done",
        data: {
          data: { code: "done", sub_code: null, updated_at: "2026-11-23T18:21:00.000Z" },
          recording: { id: "rec-1" },
          bot: { id: recallBotId, metadata: { app_bot_id: botId, transcript_enabled: "true" } },
        },
      },
      {
        event: "transcript.done",
        data: {
          data: { code: "done", sub_code: null, updated_at: "2026-11-23T18:22:00.000Z" },
          transcript: { id: "transcript-1" },
          recording: { id: "rec-1" },
          bot: { id: recallBotId, metadata: {} },
        },
      },
    ];
    for (const [index, event] of sequence.entries()) {
      const signed = signedWebhook(event, `msg_${index}`);
      const response = await harness.app.inject({ method: "POST", url: "/api/recall/webhook", headers: signed.headers, payload: signed.raw });
      expect(response.statusCode).toBe(200);
    }
    expect(harness.queue.pending()).toBe(sequence.length);
    const before = await harness.app.inject({ method: "GET", url: `/api/bots/${botId}`, headers: { cookie } });
    expect(before.json().bot.latestStatus).toBe("scheduled");
    await harness.queue.drain();

    const detail = await harness.app.inject({ method: "GET", url: `/api/bots/${botId}`, headers: { cookie } });
    expect(detail.json().bot.latestStatus).toBe("done");
    expect(detail.json().statusEvents.map((event: { code: string }) => event.code)).toEqual([
      "joining_call",
      "in_call_recording",
      "done",
    ]);
    expect(detail.json().transcripts[0].readableText).toContain("Jordan Lee");
    expect(detail.json().transcripts[0].readableText).toContain("Thanks everyone.");
    const transcriptCall = harness.calls.find((call) => call.url.includes("/create_transcript/"));
    expect(transcriptCall?.body).toEqual({
      provider: { recallai_async: { language_code: "auto" } },
      diarization: { use_separate_streams_when_available: true },
    });
    expect(transcriptCall?.authorization).toBe("test-recall-key");
    const download = harness.calls.find((call) => call.url === "https://files.example.com/transcript.json");
    expect(download?.authorization).toBeNull();
  });

  it("returns 400 and does not enqueue a bad signature or a duplicate id", async () => {
    const harness = await buildHarness();
    harnesses.push(harness);
    const event = botEvent("bot.done", "done", "recall-bot-1", "2026-11-23T18:20:00.000Z");
    const bad = await harness.app.inject({
      method: "POST",
      url: "/api/recall/webhook",
      headers: {
        "content-type": "application/json",
        "webhook-id": "msg_bad",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": "v1,not-a-real-signature",
      },
      payload: JSON.stringify(event),
    });
    expect(bad.statusCode).toBe(400);
    expect(harness.queue.pending()).toBe(0);

    const signed = signedWebhook(event, "msg_once");
    const first = await harness.app.inject({ method: "POST", url: "/api/recall/webhook", headers: signed.headers, payload: signed.raw });
    const second = await harness.app.inject({ method: "POST", url: "/api/recall/webhook", headers: signed.headers, payload: signed.raw });
    expect(first.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(harness.queue.pending()).toBe(1);
  });
});

describe("calendar scheduling", () => {
  it("schedules only opted-in future meetings and skips past, deleted, link-free, and opted-out ones", async () => {
    const harness = await buildHarness(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/api/v2/calendar-events/") && method === "GET" && !url.includes("/bot/")) {
        if (url.includes("cursor=page2")) {
          return json({
            next: null,
            results: [event("evt-deleted", "2026-11-25T15:00:00.000Z", "https://zoom.us/j/9", true)],
          });
        }
        return json({
          next: "https://us-west-2.recall.ai/api/v2/calendar-events/?cursor=page2",
          results: [
            event("evt-future", "2026-11-25T15:00:00.000Z", "https://zoom.us/j/111"),
            event("evt-past", "2026-11-20T15:00:00.000Z", "https://zoom.us/j/222"),
            event("evt-nourl", "2026-11-25T17:00:00.000Z", null),
            event("evt-optout", "2026-11-26T15:00:00.000Z", "https://meet.google.com/abc-defg-hij", false, "skip-me"),
          ],
        });
      }
      if (method === "POST" && url.endsWith("/bot/")) {
        const id = url.split("/calendar-events/")[1].split("/")[0];
        const source = event(id, "2026-11-25T15:00:00.000Z", "https://zoom.us/j/111");
        return json({ ...source, bots: [{ bot_id: `bot-${id}` }] });
      }
      if (method === "DELETE" && url.endsWith("/bot/")) {
        const id = url.split("/calendar-events/")[1].split("/")[0];
        return json({ ...event(id, "2026-11-26T15:00:00.000Z", "https://meet.google.com/abc-defg-hij"), bots: [] });
      }
      return json({});
    });
    harnesses.push(harness);
    const cookie = await login(harness.app);
    const session = await harness.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    const userId = session.json().user.id as string;
    const user = await harness.repo.getUser(userId);
    await harness.repo.upsertCalendar({
      id: "local-cal",
      recallCalendarId: "recall-cal",
      userId,
      platform: "google_calendar",
      platformEmail: "jj@gldnpr.com",
      status: "connected",
      lastSyncedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await harness.repo.savePrefs({ userId, rule: "auto_all", overrides: { "skip-me": false } });

    const sync = signedWebhook(
      { event: "calendar.sync_events", data: { calendar_id: "recall-cal", last_updated_ts: "2026-11-23T00:00:00.000Z" } },
      "msg_sync",
    );
    const accepted = await harness.app.inject({ method: "POST", url: "/api/recall/webhook", headers: sync.headers, payload: sync.raw });
    expect(accepted.statusCode).toBe(200);
    await harness.queue.drain();

    const schedules = harness.calls.filter((call) => call.method === "POST" && call.url.includes("/bot/"));
    expect(schedules.map((call) => call.url)).toEqual([
      "https://us-west-2.recall.ai/api/v2/calendar-events/evt-future/bot/",
    ]);
    const scheduledBody = schedules[0].body as { deduplication_key: string; bot_config: Record<string, unknown> };
    expect(scheduledBody.deduplication_key).toBe(
      deduplicationKey("2026-11-25T15:00:00.000Z", "https://zoom.us/j/111"),
    );
    expect(scheduledBody.bot_config.output_media).toEqual({
      camera: { kind: "webpage", config: { url: "https://bot.gldnpr.test/bot-camera" } },
    });
    expect(scheduledBody.bot_config.automatic_video_output).toBeUndefined();
    expect(scheduledBody.bot_config.chat).toBeUndefined();
    expect(scheduledBody.bot_config.meeting_url).toBeUndefined();
    expect(JSON.stringify(scheduledBody)).not.toMatch(/localhost/);
    expect(harness.calls.some((call) => call.url.includes("cursor=page2"))).toBe(true);

    const list = await harness.app.inject({ method: "GET", url: "/api/calendar", headers: { cookie } });
    const titles = list.json().events.map((event: { title: string }) => event.title);
    expect(titles).toContain("evt-future");
    expect(titles).not.toContain("evt-past");
    expect(user?.email).toBe("jj@gldnpr.com");

    harness.calls.length = 0;
    const off = await harness.app.inject({
      method: "POST",
      url: "/api/calendar/events/evt-future/recording",
      headers: { cookie },
      payload: { record: false },
    });
    expect(off.statusCode).toBe(200);
    expect(harness.calls.some((call) => call.method === "DELETE" && call.url.includes("evt-future"))).toBe(true);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: "/api/calendar",
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(harness.calls.some((call) => call.method === "DELETE" && call.url.includes("/api/v2/calendars/recall-cal"))).toBe(
      true,
    );
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function botEvent(event: string, code: string, botId: string, updatedAt: string) {
  return {
    event,
    data: { data: { code, sub_code: null, updated_at: updatedAt }, bot: { id: botId, metadata: {} } },
  };
}

function event(id: string, start: string, meetingUrl: string | null, isDeleted = false, icalUid = id) {
  const startDate = new Date(start);
  return {
    id,
    start_time: startDate.toISOString(),
    end_time: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
    calendar_id: "recall-cal",
    meeting_url: meetingUrl,
    is_deleted: isDeleted,
    ical_uid: icalUid,
    meeting_platform: meetingUrl?.includes("meet.google") ? "google_meet" : "zoom",
    raw: { summary: id, attendees: [{ email: "client@example.com" }] },
    bots: [] as Array<{ bot_id: string }>,
  };
}
