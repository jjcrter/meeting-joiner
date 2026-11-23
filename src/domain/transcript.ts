import { z } from "zod";
import { formatRelativeClock } from "./time";

const TimestampSchema = z
  .object({
    relative: z.number().nullish(),
    absolute: z.string().nullish(),
  })
  .nullish();

export const TranscriptPartSchema = z.object({
  participant: z
    .object({
      id: z.number().nullable().optional(),
      name: z.string().nullable().optional(),
      is_host: z.boolean().nullable().optional(),
      platform: z.string().nullable().optional(),
      extra_data: z.unknown().nullable().optional(),
      email: z.string().nullish(),
    })
    .optional(),
  words: z
    .array(
      z.object({
        text: z.string(),
        start_timestamp: TimestampSchema,
        end_timestamp: TimestampSchema,
      }),
    )
    .optional(),
});

export type TranscriptPart = z.infer<typeof TranscriptPartSchema>;

export interface ReadableParagraph {
  speaker: string;
  paragraph: string;
  start_timestamp: { relative: number | null; absolute: string | null };
  end_timestamp: { relative: number | null; absolute: string | null };
  duration_seconds: number | null;
}

/**
 * Speaker-grouped paragraphs. Consecutive utterances from the same participant merge.
 * Nameless participants are kept as "Unknown speaker" so audio is not dropped.
 */
export function convertToReadableTranscript(transcriptParts: TranscriptPart[]): ReadableParagraph[] {
  const parsed = z.array(TranscriptPartSchema).parse(transcriptParts);
  const keepers: TranscriptPart[] = [];
  for (const entry of parsed) {
    const words = Array.isArray(entry.words) ? entry.words : [];
    if (words.length === 0) continue;
    const key = entry.participant?.id ?? entry.participant?.name ?? "unknown";
    const last = keepers[keepers.length - 1];
    const lastKey = last ? (last.participant?.id ?? last.participant?.name ?? "unknown") : undefined;
    if (last && key === lastKey && last.words) {
      last.words.push(...words);
    } else {
      keepers.push({ ...entry, words: [...words] });
    }
  }

  return keepers.flatMap((entry) => {
    const words = entry.words ?? [];
    const paragraph = words.map((word) => word.text).join(" ").trim();
    if (!paragraph) return [];
    const first = words.find((word) => word.start_timestamp);
    const last = [...words].reverse().find((word) => word.end_timestamp);
    const startRelative = first?.start_timestamp?.relative ?? null;
    const startAbsolute = first?.start_timestamp?.absolute ?? null;
    const endRelative = last?.end_timestamp?.relative ?? null;
    const endAbsolute = last?.end_timestamp?.absolute ?? null;
    const duration =
      startRelative !== null && endRelative !== null
        ? endRelative - startRelative
        : startAbsolute && endAbsolute
          ? (Date.parse(endAbsolute) - Date.parse(startAbsolute)) / 1000
          : null;
    return [
      {
        speaker: entry.participant?.name?.trim() || "Unknown speaker",
        paragraph,
        start_timestamp: { relative: startRelative, absolute: startAbsolute },
        end_timestamp: { relative: endRelative, absolute: endAbsolute },
        duration_seconds: duration,
      },
    ];
  });
}

export function readableTranscriptText(parts: TranscriptPart[]): string {
  return convertToReadableTranscript(parts)
    .map((paragraph) => {
      const clock = formatRelativeClock(paragraph.start_timestamp.relative);
      const stamp = clock ? ` (${clock})` : "";
      return `${paragraph.speaker}${stamp}\n${paragraph.paragraph}`;
    })
    .join("\n\n");
}

export function parseTranscriptDownload(payload: unknown): TranscriptPart[] {
  const array = z.array(TranscriptPartSchema).safeParse(payload);
  if (array.success) return array.data;
  throw new Error("Transcript download was not the expected JSON array.");
}
