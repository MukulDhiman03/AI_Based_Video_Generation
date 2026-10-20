"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { voiceLabels } from "@/lib/content-creation";
import type { NarrationState } from "@/lib/narration";
import { canApplyVisualState } from "@/lib/visuals";
type Props = {
  contentId: string;
  revision: number;
  planRequestId: string;
  voice: "viraj" | "monika";
  targetDuration: number;
  enabled: boolean;
};
export function NarrationStudio({
  contentId,
  revision,
  planRequestId,
  voice,
  targetDuration,
  enabled,
}: Props) {
  const [state, setState] = useState<NarrationState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [position, setPosition] = useState(0);
  const mounted = useRef(false),
    pending = useRef(false),
    sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const identity = useRef({ revision, planRequestId });
  identity.current = { revision, planRequestId };
  async function load(method = "GET", retry = false) {
    if (pending.current) return;
    pending.current = true;
    if (method === "POST") setBusy(true);
    const token = ++sequence.current,
      started = identity.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await fetch(`/api/content/${contentId}/narration`, {
        method,
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
        ]),
        headers: { "Content-Type": "application/json" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                ...started,
                action: retry ? "retry" : "start",
              }),
            }
          : {}),
      });
      const result = await response.json();
      if (
        !mounted.current ||
        token !== sequence.current ||
        !canApplyVisualState(started, identity.current)
      )
        return;
      if (!response.ok)
        throw new Error(
          result.error ||
            "Narration status is unavailable. Recover status before retrying.",
        );
      if (!canApplyVisualState(started, result))
        throw new Error(
          "The saved plan changed in another tab. Reload this draft before continuing.",
        );
      setState(result);
      setError("");
    } catch (cause) {
      if (mounted.current && token === sequence.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Narration is unavailable. Recover status to continue.",
        );
    } finally {
      if (token === sequence.current) {
        pending.current = false;
        activeRequest.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      sequence.current++;
      activeRequest.current?.abort();
      pending.current = false;
    };
  }, [contentId, revision, planRequestId]);
  const job = state?.job,
    working = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [working, contentId, revision, planRequestId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const wait = job?.retryAt
    ? Math.max(0, Math.ceil((Date.parse(job.retryAt) - now) / 1000))
    : 0;
  const timing = enabled && job?.status === "completed" ? job.timing : null;
  const caption = timing?.captions.find(
    (c) => position >= c.start && position < c.end,
  );
  const activeScene = timing?.scenes.find(
    (s) => position >= s.start && position < s.end,
  );
  return (
    <section
      className="creator-panel narration-studio"
      aria-labelledby="narration-studio-title"
    >
      <div className="creator-plan-heading">
        <div>
          <p className="dash-eyebrow">Give your story a voice</p>
          <h2 id="narration-studio-title">Narration & synchronized captions</h2>
        </div>
        <button
          className="dash-subtle-button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} /> Recover narration status
        </button>
      </div>
      <p className="creator-muted">
        {voiceLabels[voice]} · One continuous narration track with captions
        timed to the spoken words. Scene cuts follow the audio.
      </p>
      {!enabled && (
        <p className="creator-error">
          Save your settings and generate a current plan before creating
          narration.
        </p>
      )}
      {state?.configuration.error && (
        <p className="creator-error" role="alert">
          {state.configuration.error}
        </p>
      )}
      {error && (
        <p className="creator-error" role="alert">
          {error}
        </p>
      )}
      <div className="visual-status" role="status" aria-live="polite">
        {!state ? (
          "Loading narration status…"
        ) : !job ? (
          !enabled ? (
            "Waiting for a saved, current Reel plan."
          ) : state.configuration.ready ? (
            "Your saved script is ready for narration."
          ) : (
            "Narration setup is pending."
          )
        ) : working ? (
          <>
            <LoaderCircle size={15} className="spinner" />
            {job.status === "queued"
              ? "Narration queued"
              : job.stage === "alignment"
                ? "Aligning saved audio and captions"
                : "Generating narration"}
          </>
        ) : job.status === "completed" ? (
          <>
            <Check size={15} />
            Narration and captions saved.
          </>
        ) : job.status === "failed" ? (
          "Narration needs attention. Saved audio will be reused when available."
        ) : (
          "This narration belongs to an earlier plan."
        )}
      </div>
      {job?.error && (
        <p className="creator-error" role="alert">
          {job.error}
        </p>
      )}
      <div className="creator-actions">
        {!job && (
          <button
            className="dash-button dash-button-primary"
            disabled={!enabled || busy || !state?.configuration.ready}
            onClick={() => void load("POST")}
          >
            <AudioLines size={15} />
            {busy ? "Starting…" : "Generate narration"}
          </button>
        )}
        {job?.status === "failed" && (
          <button
            className="dash-button dash-button-primary"
            disabled={
              !enabled ||
              busy ||
              !state?.configuration.ready ||
              !job.canRetry ||
              wait > 0
            }
            onClick={() => void load("POST", true)}
          >
            <RefreshCw size={15} />
            {wait > 0 ? `Retry in ${wait}s` : "Retry narration"}
          </button>
        )}
      </div>
      {job?.status === "failed" && !job.canRetry && (
        <p className="creator-muted">
          The retry limit was reached. Review your script and generate a new
          plan to continue.
        </p>
      )}
      {timing && job?.audioAssetId && (
        <div className="narration-result">
          <div className="narration-metrics">
            <span>
              <strong>{timing.duration.toFixed(2)}s</strong> measured audio
            </span>
            <span>{targetDuration}s target</span>
            <span>{timing.words.length} aligned words</span>
            <span>{timing.scenes.length} scene cuts</span>
          </div>
          {Math.abs(timing.duration - targetDuration) > 2 && (
            <p className="creator-muted">
              The spoken duration differs from the target. Audio stays at its
              natural speed; review the script before generating a new plan if
              you need a closer duration.
            </p>
          )}
          <audio
            controls
            preload="metadata"
            aria-label="Generated narration preview"
            src={`/api/narration-media/${job.audioAssetId}`}
            onTimeUpdate={(event) =>
              setPosition(event.currentTarget.currentTime)
            }
          >
            <track
              kind="captions"
              src={`/api/content/${contentId}/narration/captions?format=vtt`}
              label="Aligned captions"
            />
          </audio>
          <div
            className="narration-caption-preview"
            aria-label="Caption preview"
          >
            <span>
              {activeScene
                ? `Scene ${activeScene.index + 1} · ${activeScene.title}`
                : "Play the audio to review caption timing"}
            </span>
            <p>{caption?.text || "…"}</p>
          </div>
          <div className="creator-actions">
            <a
              className="dash-button dash-button-secondary"
              href={`/api/narration-media/${job.audioAssetId}?download=1`}
            >
              <Download size={14} /> MP3 audio
            </a>
            <a
              className="dash-button dash-button-secondary"
              href={`/api/content/${contentId}/narration/captions?format=srt`}
            >
              <Download size={14} /> SRT captions
            </a>
            <a
              className="dash-button dash-button-secondary"
              href={`/api/content/${contentId}/narration/captions?format=vtt`}
            >
              <Download size={14} /> VTT captions
            </a>
          </div>
          <details className="narration-scene-details">
            <summary>Review aligned scene timings</summary>
            <ol>
              {timing.scenes.map((scene) => (
                <li
                  key={scene.index}
                  className={
                    activeScene?.index === scene.index ? "is-active" : ""
                  }
                >
                  <span>
                    {String(scene.index + 1).padStart(2, "0")} · {scene.title}
                  </span>
                  <span>
                    {scene.start.toFixed(2)}s–{scene.end.toFixed(2)}s
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
      <p className="creator-footnote">
        Speech generation uses ElevenLabs credits. Requests are not retried
        automatically. Private audio is stored in R2; recovery and alignment
        retries reuse saved audio. Reel animation and MP4 rendering come next.
      </p>
    </section>
  );
}
