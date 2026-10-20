import { z } from "zod";
import type { ContentPlan } from "./content-creation";

export const narrationRequestSchema = z.object({
  revision: z.number().int().positive(),
  planRequestId: z.uuid(),
  action: z.enum(["start", "retry"]).default("start"),
});
export const approvedNarrationVoices = {
  viraj: "bajNon13EdhNMndG3z05",
  monika: "2zRM7PkgwBPiau2jvVXc",
} as const;
export type CharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};
export type SpeechResult = {
  audio: Buffer;
  alignment: CharacterAlignment | null;
  normalizedAlignment: CharacterAlignment | null;
};
export type TimedWord = {
  text: string;
  start: number;
  end: number;
  sceneIndex: number;
};
export type CaptionCue = { text: string; start: number; end: number };
export type NarrationTiming = {
  duration: number;
  fps: 30;
  totalFrames: number;
  words: TimedWord[];
  captions: CaptionCue[];
  scenes: {
    index: number;
    title: string;
    start: number;
    end: number;
    from: number;
    to: number;
  }[];
};
export type NarrationState = {
  revision: number;
  planRequestId: string;
  configuration: { ready: boolean; error: string | null };
  job: null | {
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    stage: "speech" | "alignment" | "completed";
    attempts: number;
    error: string | null;
    canRetry: boolean;
    retryAt: string | null;
    audioAssetId: string | null;
    timing: NarrationTiming | null;
    voice: "viraj" | "monika";
    updatedAt: string;
  };
};
export function narrationText(plan: ContentPlan) {
  const parts = plan.scenes.map((s) => s.narration.trim());
  if (parts.some((p) => !p))
    throw new Error("Every Reel scene needs narration.");
  const text = parts.join(" ");
  if (text.length > 8000)
    throw new Error(
      "The narration exceeds the 8,000-character limit. Shorten the saved script.",
    );
  return text;
}
function alignedWords(alignment: CharacterAlignment, text: string) {
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = alignment;
  if (
    !characters.length ||
    characters.length > 24000 ||
    characters.length !== starts.length ||
    starts.length !== ends.length
  )
    throw new Error("Invalid character timing lengths.");
  const offsets: { start: number; end: number }[] = [];
  let previousStart = 0,
    previousEnd = 0;
  for (let i = 0; i < characters.length; i++) {
    if (
      typeof characters[i] !== "string" ||
      !characters[i].length ||
      !Number.isFinite(starts[i]) ||
      !Number.isFinite(ends[i]) ||
      starts[i] < previousStart ||
      starts[i] < 0 ||
      ends[i] < starts[i] ||
      ends[i] < previousEnd
    )
      throw new Error("Invalid character timings.");
    previousStart = starts[i];
    previousEnd = ends[i];
    for (let j = 0; j < characters[i].length; j++)
      offsets.push({ start: starts[i], end: ends[i] });
  }
  const transcript = characters.join("");
  const matches = [...transcript.matchAll(/\S+/gu)],
    expected = [...text.matchAll(/\S+/gu)];
  if (
    matches.length !== expected.length ||
    matches.some(
      (m, i) => m[0].normalize("NFC") !== expected[i][0].normalize("NFC"),
    )
  )
    throw new Error(
      "Speech timestamps do not match the saved script. The original audio is retained; revise the plan before generating again.",
    );
  const words = matches.map((m) => ({
    text: m[0],
    start: offsets[m.index].start,
    end: offsets[m.index + m[0].length - 1].end,
  }));
  if (
    words.some(
      (w, i) => w.end <= w.start || (i > 0 && w.start < words[i - 1].end),
    )
  )
    throw new Error("Speech word timings overlap or are empty.");
  return words;
}
export function alignNarration(
  plan: ContentPlan,
  result: Pick<SpeechResult, "alignment" | "normalizedAlignment">,
  duration: number,
): NarrationTiming {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
    throw new Error("Invalid measured audio duration.");
  const text = narrationText(plan);
  let words: ReturnType<typeof alignedWords> | undefined, failure: unknown;
  for (const alignment of [result.alignment, result.normalizedAlignment]) {
    if (!alignment) continue;
    try {
      words = alignedWords(alignment, text);
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (!words?.length)
    throw failure ?? new Error("Speech timestamps are missing.");
  if (words.at(-1)!.end > duration + 0.05)
    throw new Error("Speech timing extends beyond the measured audio.");
  words = words.map((w) => ({ ...w, end: Math.min(w.end, duration) }));
  let offset = 0;
  const starts = plan.scenes.map((s) => {
    const index = offset;
    offset += s.narration.trim().match(/\S+/gu)!.length;
    return index;
  });
  const timedWords: TimedWord[] = words.map((w, index) => ({
    ...w,
    sceneIndex: starts.findLastIndex((start) => index >= start),
  }));
  const totalFrames = Math.ceil(duration * 30);
  const scenes = plan.scenes.map((s, index) => {
    const start = index === 0 ? 0 : words![starts[index]].start;
    const end =
      index === plan.scenes.length - 1
        ? duration
        : words![starts[index + 1]].start;
    return {
      index,
      title: s.title,
      start,
      end,
      from: Math.ceil(start * 30),
      to: index === plan.scenes.length - 1 ? totalFrames : Math.ceil(end * 30),
    };
  });
  if (scenes.some((s) => s.to <= s.from))
    throw new Error("A scene is shorter than one video frame.");
  const captions: CaptionCue[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (group.length) {
      captions.push({
        text: group.map((w) => w.text).join(" "),
        start: group[0].start,
        end: group.at(-1)!.end,
      });
      group = [];
    }
  };
  for (const w of timedWords) {
    if (
      group.length &&
      (group.length >= 5 ||
        group[0].sceneIndex !== w.sceneIndex ||
        w.end - group[0].start > 2.5 ||
        group.map((x) => x.text).join(" ").length + w.text.length + 1 > 42)
    )
      flush();
    group.push(w);
    if (/[.!?।]$/u.test(w.text)) flush();
  }
  flush();
  return {
    duration,
    fps: 30,
    totalFrames,
    words: timedWords,
    captions,
    scenes,
  };
}
export function captionFile(timing: NarrationTiming, format: "srt" | "vtt") {
  const stamp = (time: number) => {
    const ms = Math.round(time * 1000);
    const h = Math.floor(ms / 3600000),
      m = Math.floor(ms / 60000) % 60,
      s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
  };
  return (
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    timing.captions
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/[<>\r\n]/g, " ")}\n`,
      )
      .join("\n")
  );
}
