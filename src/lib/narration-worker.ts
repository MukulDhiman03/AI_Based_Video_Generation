import type { VisualSnapshot } from "./visuals";
import type { NarrationTiming, SpeechResult } from "./narration";
export type NarrationWork = {
  jobId: string;
  lease: string;
  userId: string;
  contentId: string;
  snapshot: VisualSnapshot;
  voice: "viraj" | "monika";
  sourceAssetId: string | null;
};
export type SavedSpeech = Omit<SpeechResult, "audio"> & { duration: number };
export type NarrationWorkerDependencies = {
  claim: () => Promise<NarrationWork | null>;
  current: (w: NarrationWork) => Promise<boolean>;
  admit: (w: NarrationWork) => Promise<void>;
  generate: (w: NarrationWork) => Promise<SpeechResult>;
  measure: (audio: Buffer) => Promise<number>;
  save: (
    w: NarrationWork,
    result: SpeechResult,
    duration: number,
  ) => Promise<string>;
  load: (id: string, userId: string) => Promise<SavedSpeech>;
  checkpoint: (w: NarrationWork, id: string) => Promise<boolean>;
  align: (w: NarrationWork, source: SavedSpeech) => NarrationTiming;
  complete: (w: NarrationWork, timing: NarrationTiming) => Promise<boolean>;
  discard: (id: string, userId: string) => Promise<void>;
  cancel: (w: NarrationWork) => Promise<void>;
  fail: (w: NarrationWork, error: unknown) => Promise<void>;
};
export async function processNarrationStep(deps: NarrationWorkerDependencies) {
  const work = await deps.claim();
  if (!work) return false;
  try {
    if (!(await deps.current(work))) {
      await deps.cancel(work);
      return true;
    }
    let source: SavedSpeech;
    if (work.sourceAssetId)
      source = await deps.load(work.sourceAssetId, work.userId);
    else {
      await deps.admit(work);
      if (!(await deps.current(work))) {
        await deps.cancel(work);
        return true;
      }
      const result = await deps.generate(work),
        duration = await deps.measure(result.audio);
      const id = await deps.save(work, result, duration);
      if (!(await deps.checkpoint(work, id))) {
        await deps.discard(id, work.userId);
        await deps.cancel(work);
        return true;
      }
      source = {
        alignment: result.alignment,
        normalizedAlignment: result.normalizedAlignment,
        duration,
      };
    }
    if (!(await deps.current(work))) {
      await deps.cancel(work);
      return true;
    }
    if (!(await deps.complete(work, deps.align(work, source))))
      await deps.cancel(work);
  } catch (error) {
    await deps.fail(work, error);
  }
  return true;
}
