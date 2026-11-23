import { describe, expect, it } from "vitest";
import { automaticVideoOutput, loadBotBackground } from "../src/domain/video";

describe("branded camera tile", () => {
  it("loads the committed 1280x720 jpeg and encodes it with the standard alphabet", () => {
    const asset = loadBotBackground();
    expect(asset.width).toBe(1280);
    expect(asset.height).toBe(720);
    expect(asset.buffer.length).toBeLessThan(1_300_000);
    expect(asset.buffer[0]).toBe(0xff);
    expect(asset.buffer[1]).toBe(0xd8);
    expect(asset.base64).toBe(asset.buffer.toString("base64"));
    expect(asset.base64).not.toContain("\n");
    const video = automaticVideoOutput(asset.base64);
    expect(video.in_call_not_recording).toEqual({ kind: "jpeg", b64_data: asset.base64 });
    expect(video.in_call_recording).toEqual({ kind: "jpeg", b64_data: asset.base64 });
  });
});
