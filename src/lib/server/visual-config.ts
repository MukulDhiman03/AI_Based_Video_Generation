import "server-only";
import type { VisualState } from "../visuals";
export function visualConfiguration(): VisualState["configuration"] {
  const storage = process.env.VISUAL_STORAGE === "r2" ? "r2" : null;
  const worker =
    process.env.VISUAL_WORKER_MODE === "node" && !process.env.VERCEL
      ? "node"
      : process.env.VISUAL_WORKER_MODE === "dispatch"
        ? "dispatch"
        : "disabled";
  let error: string | null = null;
  if (!process.env.GEMINI_API_KEY)
    error =
      "Configure Gemini image-generation access before generating visuals.";
  else if (!storage)
    error = "Choose private visual storage before generating visuals.";
  else if (
    storage === "r2" &&
    ![
      process.env.R2_ACCOUNT_ID,
      process.env.R2_BUCKET_NAME,
      process.env.R2_ACCESS_KEY_ID,
      process.env.R2_SECRET_ACCESS_KEY,
    ].every(Boolean)
  )
    error = "R2 storage needs its account, bucket, and access credentials.";
  else if (
    storage === "r2" &&
    !/^[a-f\d]{32}$/i.test(process.env.R2_ACCOUNT_ID || "")
  )
    error = "R2 storage needs a valid Cloudflare account ID.";
  else if (process.env.VISUAL_GENERATION_ENABLED !== "true")
    error =
      "Image generation is paused. Enable Gemini image access, then set VISUAL_GENERATION_ENABLED=true.";
  else if (
    worker === "disabled" ||
    (worker === "dispatch" &&
      (!process.env.VISUAL_WORKER_SECRET ||
        process.env.VISUAL_WORKER_SECRET.length < 32 ||
        process.env.VISUAL_DISPATCH_SCHEDULED !== "true"))
  )
    error = "The background visual processor needs configuration.";
  return { storage, ready: !error, error, worker };
}
