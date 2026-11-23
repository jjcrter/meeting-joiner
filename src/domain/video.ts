import fs from "node:fs";
import path from "node:path";

export interface JpegAsset {
  buffer: Buffer;
  base64: string;
  width: number;
  height: number;
}

export function defaultBackgroundPath(): string {
  return path.resolve(process.cwd(), "assets/bot-background.jpg");
}

export function readJpegSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Bot background is not a JPEG.");
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("Bot background JPEG is missing its size marker.");
}

/** Load the branded camera tile. Recall wants a 16:9 JPEG, 1280x720 recommended, at most 1.3 MB. */
export function loadBotBackground(filePath = defaultBackgroundPath()): JpegAsset {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. The bot camera tile is assets/bot-background.jpg. See README section Branded camera tile.`,
    );
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length > 1_300_000) {
    throw new Error("assets/bot-background.jpg is over Recall's 1.3 MB JPEG limit.");
  }
  const { width, height } = readJpegSize(buffer);
  if (width !== 1280 || height !== 720) {
    throw new Error(
      `assets/bot-background.jpg is ${width}x${height}. Recall's recommended camera image is 1280x720 (16:9).`,
    );
  }
  return {
    buffer,
    base64: buffer.toString("base64"),
    width,
    height,
  };
}

export function automaticVideoOutput(base64: string): {
  in_call_not_recording: { kind: "jpeg"; b64_data: string };
  in_call_recording: { kind: "jpeg"; b64_data: string };
} {
  const image = { kind: "jpeg" as const, b64_data: base64 };
  return {
    in_call_not_recording: { ...image },
    in_call_recording: { ...image },
  };
}
