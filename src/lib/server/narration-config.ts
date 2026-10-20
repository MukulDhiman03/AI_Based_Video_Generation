import "server-only";
import { approvedNarrationVoices } from "../narration";
export function narrationConfiguration(voice: "viraj" | "monika") {
  const configured =
    process.env[
      voice === "viraj"
        ? "ELEVENLABS_VOICE_VIRAJ_ENERGETIC_CONFIDENT"
        : "ELEVENLABS_VOICE_MONIKA_DEEP_NATURAL"
    ];
  let error: string | null = null;
  if (!process.env.ELEVENLABS_API_KEY)
    error = "Configure ElevenLabs access before generating narration.";
  else if (configured && configured !== approvedNarrationVoices[voice])
    error = "Configure the approved Viraj and Monika voice IDs.";
  else if (
    process.env.VISUAL_STORAGE !== "r2" ||
    !/^[a-f\d]{32}$/i.test(process.env.R2_ACCOUNT_ID || "") ||
    !process.env.R2_BUCKET_NAME ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  )
    error =
      "Private R2 storage needs its account, bucket, and access credentials.";
  else if (process.env.NARRATION_GENERATION_ENABLED !== "true")
    error =
      "Narration is paused. Enable ElevenLabs access and configure NARRATION_GENERATION_ENABLED=true.";
  else if (!(
    (process.env.VISUAL_WORKER_MODE === "node" && !process.env.VERCEL) ||
    (process.env.VISUAL_WORKER_MODE === "dispatch" &&
      (process.env.VISUAL_WORKER_SECRET?.length || 0) >= 32 &&
      process.env.VISUAL_DISPATCH_SCHEDULED === "true")
  ))
    error =
      "Configure the background media processor before generating narration.";
  return { ready: !error, error };
}
