export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.VISUAL_WORKER_MODE === "node" &&
    !process.env.VERCEL
  ) {
    const { startVisualWorker } = await import("./lib/server/visual-runner");
    startVisualWorker();
  }
}
