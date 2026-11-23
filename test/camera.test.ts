import { afterEach, describe, expect, it } from "vitest";
import { WEBPAGE_CAMERA_VARIANT } from "../src/domain/botConfig";
import { buildHarness, login } from "./helpers";

const harnesses: Array<{ app: { close: () => Promise<void> } }> = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((item) => item.app.close()));
});

describe("animated camera tile", () => {
  it("serves a public 1280x720 page and a range-capable mp4", async () => {
    const harness = await buildHarness();
    harnesses.push(harness);
    const page = await harness.app.inject({ method: "GET", url: "/bot-camera" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("width: 1280px");
    expect(page.body).toContain("height: 720px");
    expect(page.body).toContain("object-fit: cover");
    expect(page.body).toContain('autoplay muted loop playsinline');
    expect(page.body).toContain('src="/media/gldn-brand-03-loop.mp4"');
    expect(page.body).not.toContain("<button");

    const file = await harness.app.inject({ method: "GET", url: "/media/gldn-brand-03-loop.mp4" });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("video/mp4");
    expect(file.headers["accept-ranges"]).toBe("bytes");
    expect(Number(file.headers["content-length"])).toBeGreaterThan(1000);

    const partial = await harness.app.inject({
      method: "GET",
      url: "/media/gldn-brand-03-loop.mp4",
      headers: { range: "bytes=0-99" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-type"]).toContain("video/mp4");
    expect(partial.headers["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect(partial.rawPayload.length).toBe(100);
  });

  it("uses the static jpeg and omits webpage output when BOT_CAMERA_MODE=image", async () => {
    const harness = await buildHarness(undefined, { botCameraMode: "image" });
    harnesses.push(harness);
    const cookie = await login(harness.app);
    const launch = await harness.app.inject({
      method: "POST",
      url: "/api/bots",
      headers: { cookie },
      payload: { meetingUrl: "https://meet.google.com/abc-defg-hij" },
    });
    expect(launch.statusCode).toBe(201);
    const body = harness.calls[0].body as {
      automatic_video_output: { in_call_recording: { b64_data: string }; in_call_not_recording: { kind: string } };
      output_media?: unknown;
      variant?: unknown;
    };
    expect(body.output_media).toBeUndefined();
    expect(body.variant).toBeUndefined();
    expect(body.automatic_video_output.in_call_recording.b64_data).toBe(harness.background.base64);
    expect(body.automatic_video_output.in_call_not_recording.kind).toBe("jpeg");
    expect(WEBPAGE_CAMERA_VARIANT.zoom).toBe("web_4_core");
  });
});
