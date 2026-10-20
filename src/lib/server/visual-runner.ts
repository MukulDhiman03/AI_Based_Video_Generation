import "server-only";
import { processVisualStep } from "../visual-worker";
import { processNarrationStep } from "../narration-worker";
import { createNarrationWorkerDependencies } from "./narration-jobs";
import { createVisualWorkerDependencies } from "./visual-jobs";
const runtime = globalThis as typeof globalThis & {
  vidsutraVisualLoop?: boolean;
  vidsutraNarrationTurn?: boolean;
};
export async function runVisualStep() {
  return processVisualStep(createVisualWorkerDependencies());
}
export async function runNarrationStep() {
  return processNarrationStep(createNarrationWorkerDependencies());
}
export async function runMediaStep() {
  runtime.vidsutraNarrationTurn = !runtime.vidsutraNarrationTurn;
  const first = runtime.vidsutraNarrationTurn
    ? runNarrationStep
    : runVisualStep;
  const second = runtime.vidsutraNarrationTurn
    ? runVisualStep
    : runNarrationStep;
  return (await first()) || (await second());
}
export function startVisualWorker() {
  if (
    runtime.vidsutraVisualLoop ||
    process.env.VISUAL_WORKER_MODE !== "node" ||
    process.env.VERCEL ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
    return;
  runtime.vidsutraVisualLoop = true;
  async function tick() {
    let worked = false;
    try {
      worked = await runMediaStep();
    } catch {
      console.warn(
        "Media worker is temporarily unavailable; queued work remains saved.",
      );
    }
    const timer = setTimeout(
      () => {
        void tick();
      },
      worked ? 100 : 3000,
    );
    timer.unref();
  }
  const timer = setTimeout(() => {
    void tick();
  }, 1000);
  timer.unref();
}
