"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { canApplyVisualState, type VisualState } from "@/lib/visuals";

export function VisualStudio({
  contentId,
  revision,
  planRequestId,
  format,
  enabled,
}: {
  contentId: string;
  revision: number;
  planRequestId: string;
  format: "reel" | "image";
  enabled: boolean;
}) {
  const [state, setState] = useState<VisualState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const alive = useRef(true);
  const action = useRef(false);
  const sequence = useRef(0);
  const identity = useRef({ revision, planRequestId });
  identity.current = { revision, planRequestId };
  async function load(method = "GET", retry = false) {
    if (method === "POST") {
      if (action.current) return;
      action.current = true;
      setBusy(true);
    } else if (action.current) return;
    const token = ++sequence.current;
    const started = identity.current;
    if (method === "POST") setError("");
    try {
      const response = await fetch(`/api/content/${contentId}/visuals`, {
        method,
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                revision: started.revision,
                planRequestId: started.planRequestId,
                action: retry ? "retry" : "start",
              }),
            }
          : {}),
      });
      const result = await response.json();
      if (
        !alive.current ||
        token !== sequence.current ||
        !canApplyVisualState(started, identity.current)
      )
        return;
      if (!response.ok)
        throw new Error(
          result.error || "Visual generation could not be started.",
        );
      if (!canApplyVisualState(started, result))
        throw new Error(
          "The saved plan changed in another tab. Reload the content draft before continuing.",
        );
      setState(result);
      setError("");
    } catch (error) {
      if (alive.current && token === sequence.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not connect. Recover visual status to continue.",
        );
    } finally {
      if (method === "POST") {
        action.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [contentId, revision, planRequestId]);
  const working =
    state?.batch?.status === "queued" || state?.batch?.status === "running";
  useEffect(() => {
    if (!working || busy) return;
    const timer = setTimeout(() => void load(), 3000);
    return () => clearTimeout(timer);
  }, [state, busy, working]);
  useEffect(() => {
    const update = () =>
      setWait(
        state?.batch?.retryAt
          ? Math.max(
              0,
              Math.ceil(
                (new Date(state.batch.retryAt).getTime() - Date.now()) / 1000,
              ),
            )
          : 0,
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state?.batch?.retryAt]);
  const batch = state?.batch;
  return (
    <section
      className="creator-panel visual-studio"
      aria-labelledby="visual-studio-title"
    >
      <div className="creator-plan-heading">
        <div>
          <p className="dash-eyebrow">Bring your explanation to life</p>
          <h2 id="visual-studio-title">
            {format === "image"
              ? "Generate your image post"
              : "Generate scene illustrations"}
          </h2>
        </div>
        <button
          className="dash-subtle-button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} /> Recover visual status
        </button>
      </div>
      <p className="creator-muted">
        Artwork follows your saved plan. Labels are typeset separately for
        readable English and Hindi. Completed scenes are saved as generation
        progresses.
      </p>
      {!enabled && (
        <p className="creator-error">
          Your brief or plan has changed. Save the settings and generate a
          current plan before creating visuals.
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
          "Loading visual status…"
        ) : !batch ? (
          !enabled ? (
            "Waiting for a saved, current plan."
          ) : state.configuration.ready ? (
            "Ready to turn your plan into illustrations."
          ) : (
            "Visual setup is pending."
          )
        ) : batch.status === "completed" ? (
          <>
            <Check size={15} />{" "}
            {format === "image"
              ? "Image composition saved."
              : `All ${batch.total} scene illustrations saved.`}
          </>
        ) : working ? (
          <>
            <LoaderCircle className="spinner" size={15} /> {batch.completed} of{" "}
            {batch.total} scenes saved ·{" "}
            {batch.status === "queued"
              ? "Queued for generation"
              : "Generating illustration"}
          </>
        ) : batch.status === "failed" ? (
          `${batch.completed} of ${batch.total} scenes saved. Unfinished work needs attention.`
        ) : (
          "This visual run belongs to a previous plan."
        )}
      </div>
      {batch?.error && (
        <p className="creator-error" role="alert">
          {batch.error}
        </p>
      )}
      <div className="creator-actions">
        {!batch && (
          <button
            className="dash-button dash-button-primary"
            disabled={!enabled || busy || !state?.configuration.ready}
            onClick={() => void load("POST")}
          >
            <Sparkles size={15} />
            {busy ? "Starting…" : "Generate visuals"}
          </button>
        )}
        {batch?.status === "failed" && (
          <button
            className="dash-button dash-button-primary"
            disabled={
              !enabled ||
              busy ||
              !state?.configuration.ready ||
              !batch.canRetry ||
              wait > 0
            }
            onClick={() => void load("POST", true)}
          >
            <RefreshCw size={15} />
            {wait > 0 ? `Retry in ${wait}s` : "Retry unfinished visuals"}
          </button>
        )}
      </div>
      {batch && !batch.canRetry && batch.status === "failed" && (
        <p className="creator-muted">
          The retry limit was reached. Review the brief and generate a new plan
          before starting a new visual run.
        </p>
      )}
      {enabled && batch && (
        <div
          className={`visual-gallery ${format === "image" ? "is-image" : ""}`}
        >
          {batch.scenes.map((scene) => (
            <article className="visual-card" key={scene.index}>
              <div className={`visual-image ${format}`}>
                {scene.status === "completed" && scene.assetId ? (
                  <img
                    src={`/api/media/${scene.assetId}`}
                    alt={`Generated illustration for ${scene.title}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="visual-placeholder">
                    {scene.status === "running" ? (
                      <LoaderCircle className="spinner" size={25} />
                    ) : (
                      <ImageIcon size={25} />
                    )}
                    <span>
                      {scene.status === "running"
                        ? "Generating…"
                        : scene.status === "failed"
                          ? "Needs retry"
                          : "Waiting in queue"}
                    </span>
                  </div>
                )}
              </div>
              <div className="visual-card-copy">
                <small>
                  {format === "image"
                    ? "IMAGE POST"
                    : `SCENE ${String(scene.index + 1).padStart(2, "0")}`}
                </small>
                <h3>{scene.title}</h3>
                <p>
                  {scene.status === "completed"
                    ? "Saved privately · PNG"
                    : scene.status === "failed"
                      ? scene.error
                      : "Your illustration will appear here."}
                </p>
                {scene.assetId && scene.status === "completed" && (
                  <a
                    className="dash-button dash-button-secondary"
                    href={`/api/media/${scene.assetId}?download=1`}
                  >
                    <Download size={14} /> Download PNG
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="creator-footnote">
        Visuals are stored privately in R2 and served only to your signed-in
        account. Background generation continues when you close this tab while
        the server is running. Reels still need narration, synchronized
        captions, and rendering in the next stages.
      </p>
    </section>
  );
}
