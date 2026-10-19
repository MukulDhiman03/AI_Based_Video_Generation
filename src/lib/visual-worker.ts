import type { VisualSnapshot } from "./visuals";
export type VisualWork = {
  jobId: string;
  lease: string;
  index: number;
  snapshot: VisualSnapshot;
  rawAssetId: string | null;
  referenceAssetId: string | null;
  userId: string;
};
export type VisualWorkerDependencies = {
  claim: () => Promise<VisualWork | null>;
  current: (work: VisualWork) => Promise<boolean>;
  admit: (work: VisualWork) => Promise<void>;
  generate: (work: VisualWork, reference?: Buffer) => Promise<Buffer>;
  load: (assetId: string, userId: string) => Promise<Buffer>;
  normalize: (bytes: Buffer, work: VisualWork) => Promise<Buffer>;
  compose: (bytes: Buffer, work: VisualWork) => Promise<Buffer>;
  save: (
    bytes: Buffer,
    work: VisualWork,
    variant: "artwork" | "composition",
  ) => Promise<string>;
  checkpoint: (
    work: VisualWork,
    assetId: string,
    variant: "artwork" | "composition",
  ) => Promise<boolean>;
  discard: (assetId: string, userId: string) => Promise<void>;
  cancel: (work: VisualWork) => Promise<void>;
  fail: (work: VisualWork, error: unknown) => Promise<void>;
};
// The raw-artwork checkpoint survives composition/storage failures. A manual
// retry can finish that scene without paying to generate its illustration again.
export async function processVisualStep(deps: VisualWorkerDependencies) {
  const work = await deps.claim();
  if (!work) return false;
  try {
    if (!(await deps.current(work))) {
      await deps.cancel(work);
      return true;
    }
    let artwork: Buffer;
    if (work.rawAssetId)
      artwork = await deps.load(work.rawAssetId, work.userId);
    else {
      const reference = work.referenceAssetId
        ? await deps.load(work.referenceAssetId, work.userId)
        : undefined;
      await deps.admit(work);
      if (!(await deps.current(work))) {
        await deps.cancel(work);
        return true;
      }
      artwork = await deps.normalize(
        await deps.generate(work, reference),
        work,
      );
      const rawId = await deps.save(artwork, work, "artwork");
      if (!(await deps.checkpoint(work, rawId, "artwork"))) {
        await deps.discard(rawId, work.userId);
        await deps.cancel(work);
        return true;
      }
    }
    if (!(await deps.current(work))) {
      await deps.cancel(work);
      return true;
    }
    const composition = await deps.compose(artwork, work);
    const assetId = await deps.save(composition, work, "composition");
    if (!(await deps.checkpoint(work, assetId, "composition"))) {
      await deps.discard(assetId, work.userId);
      await deps.cancel(work);
    }
  } catch (error) {
    await deps.fail(work, error);
  }
  return true;
}
