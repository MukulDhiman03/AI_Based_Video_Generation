import { bundle } from "@remotion/bundler";
import {
  selectComposition,
  renderMedia,
  renderStill,
} from "@remotion/renderer";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseRenderPlan } from "../src/render-plan.mjs";
let rawPlan;
try {
  rawPlan = await readFile("public/generated/plan.json", "utf8");
} catch (error) {
  if (error.code === "ENOENT")
    throw new Error(
      "No generated plan found. Run npm run generate before rendering.",
    );
  throw error;
}
const plan = parseRenderPlan(JSON.parse(rawPlan));
const inputProps = { plan };
await mkdir("output", { recursive: true });
const serveUrl = await bundle({
  entryPoint: "src/index.tsx",
  publicDir: "public",
});
const composition = await selectComposition({
  serveUrl,
  id: "InternetExplainer",
  inputProps,
});
for (const [i, s] of plan.scenes.entries())
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame: Math.min(s.from + 30, s.to - 1),
    output: "output/scene-" + (i + 1) + ".png",
  });
if (process.argv.includes("--stills")) process.exit(0);
let last = -1;
await renderMedia({
  serveUrl,
  composition,
  inputProps,
  codec: "h264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  crf: 20,
  outputLocation: "output/vidsutra-internet-explainer.mp4",
  concurrency: 2,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10) * 10;
    if (p !== last) {
      last = p;
      console.log("Rendering " + p + "%");
    }
  },
});
await writeFile(
  "output/render-summary.json",
  JSON.stringify(
    {
      voice: plan.voice,
      duration: plan.duration,
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      scenes: plan.scenes.length,
      words: plan.words.length,
      timing:
        "ElevenLabs character alignment, rounded to 30fps scene boundaries",
    },
    null,
    2,
  ),
);
console.log("Video saved to output/vidsutra-internet-explainer.mp4");
