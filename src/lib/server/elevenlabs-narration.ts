import "server-only";
import { z } from "zod";
import { parseBuffer } from "music-metadata";
import { approvedNarrationVoices, type SpeechResult } from "../narration";
import { IdeaError } from "./errors";
const alignment = z.object({
  characters: z.array(z.string().min(1).max(32)).max(24000),
  character_start_times_seconds: z.array(z.number().finite()).max(24000),
  character_end_times_seconds: z.array(z.number().finite()).max(24000),
});
const speech = z.object({
  audio_base64: z.string().min(4).max(16_000_000),
  alignment: alignment.nullish(),
  normalized_alignment: alignment.nullish(),
});
async function readJson(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new IdeaError("ElevenLabs returned an empty response.", 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new IdeaError(
        "ElevenLabs response exceeded the supported size.",
        502,
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new IdeaError("ElevenLabs returned unreadable data.", 502);
  }
}
function providerFailure(status: number): never {
  if (status === 401 || status === 403)
    throw new IdeaError(
      "ElevenLabs access was denied. Check the API key, selected voice access, and plan entitlement.",
      503,
    );
  if (status === 429)
    throw new IdeaError(
      "ElevenLabs is rate-limited or has insufficient credits. Check your allowance before retrying.",
      429,
    );
  throw new IdeaError(
    "ElevenLabs could not complete narration. Saved audio is retained; retry after checking provider availability.",
    503,
  );
}
export async function measureNarrationAudio(audio: Buffer) {
  if (audio.length < 100 || audio.length > 12_000_000)
    throw new IdeaError("The narration audio has an unsupported size.", 502);
  try {
    const metadata = await parseBuffer(
      audio,
      { mimeType: "audio/mpeg", size: audio.length },
      { duration: true, skipCovers: true },
    );
    const duration = metadata.format.duration;
    if (
      metadata.format.container !== "MPEG" ||
      !duration ||
      !Number.isFinite(duration) ||
      duration > 300
    )
      throw new Error();
    return duration;
  } catch {
    throw new IdeaError(
      "ElevenLabs did not return a valid MP3 with a measurable duration.",
      502,
    );
  }
}
export async function checkNarrationAccess(
  voice: "viraj" | "monika",
  characters: number,
  fetcher: typeof fetch = fetch,
) {
  const headers = { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" };
  const voiceResponse = await fetcher(
    `https://api.elevenlabs.io/v1/voices/${approvedNarrationVoices[voice]}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!voiceResponse.ok) providerFailure(voiceResponse.status);
  await voiceResponse.body?.cancel();
  const response = await fetcher(
    "https://api.elevenlabs.io/v1/user/subscription",
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      throw new IdeaError(
        "ElevenLabs subscription access was denied. Enable subscription-read permission for this API key so the available credits can be checked.",
        503,
      );
    providerFailure(response.status);
  }
  const data = await readJson(response, 100_000);
  // Never automatically use paid overage credits.
  if (
    !Number.isFinite(data.character_count) ||
    !Number.isFinite(data.character_limit) ||
    data.character_limit - data.character_count < characters
  )
    throw new IdeaError(
      "The ElevenLabs allowance is insufficient or unavailable. Check credits before generating narration.",
      429,
    );
}
export async function generateNarration(
  voice: "viraj" | "monika",
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<SpeechResult> {
  if (process.env.NARRATION_GENERATION_ENABLED !== "true")
    throw new IdeaError("Narration generation is paused.", 503);
  let response: Response;
  try {
    response = await fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${approvedNarrationVoices[voice]}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
  } catch {
    throw new IdeaError(
      "ElevenLabs did not respond in time. The request may have consumed credits. Recover status before manually retrying.",
      503,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    providerFailure(response.status);
  }
  const parsed = speech.safeParse(await readJson(response, 20_000_000));
  if (!parsed.success)
    throw new IdeaError(
      "ElevenLabs returned incomplete narration or timestamps.",
      502,
    );
  const data = parsed.data;
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio_base64) ||
    data.audio_base64.length % 4 !== 0
  )
    throw new IdeaError("ElevenLabs returned invalid audio data.", 502);
  return {
    audio: Buffer.from(data.audio_base64, "base64"),
    alignment: data.alignment ?? null,
    normalizedAlignment: data.normalized_alignment ?? null,
  };
}
