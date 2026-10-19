"use client";
import Link from "next/link";
import { VisualStudio } from "./visual-studio";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Mic,
  RefreshCw,
  Save,
  Sparkles,
  Video,
} from "lucide-react";
import {
  contentRecoverySchema,
  contentFormSchema,
  defaultConfig,
  voiceLabels,
  type ContentForm,
  type ContentItem,
} from "@/lib/content-creation";

const emptyForm: ContentForm = {
  brief: { title: "", hook: "", summary: "" },
  config: defaultConfig,
};
type PendingSave = { revision: number; mutationId: string; form: ContentForm };
async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as {
    item?: ContentItem;
    error?: string;
  };
  if (!response.ok && response.status !== 409)
    throw new Error(
      data.error ||
        "Could not connect. Your draft remains here; retry to continue.",
    );
  return { ...data, status: response.status };
}
export function ContentComposer({
  userId,
  initialItem,
}: {
  userId: string;
  initialItem: ContentItem | null;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const itemRef = useRef(initialItem);
  const [form, setForm] = useState<ContentForm>(initialItem?.form ?? emptyForm);
  const formRef = useRef(form);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const recoveringRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<ContentItem | null>(null);
  const [regenerate, setRegenerate] = useState(false);
  const alive = useRef(true);
  const pendingSave = useRef<PendingSave | null>(null);
  const creation = useRef<{ creationId: string; form: ContentForm } | null>(
    null,
  );
  const planningIntent = useRef<{ revision: number; requestId: string } | null>(
    null,
  );
  const storageKey = `vidsutra:content:${userId}:${initialItem?.id ?? "new"}`;
  function backup() {
    if (!alive.current) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          form: formRef.current,
          revision: itemRef.current?.revision ?? 0,
          mutationId: pendingSave.current?.mutationId ?? null,
          creation: creation.current,
        }),
      );
    } catch {
      setNotice(
        "Browser recovery is unavailable. Save your draft before leaving this page.",
      );
    }
  }
  useEffect(() => {
    alive.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        stored?.form &&
        contentRecoverySchema.safeParse(stored.form).success &&
        JSON.stringify(stored.form) !==
          JSON.stringify(initialItem?.form ?? emptyForm)
      ) {
        formRef.current = stored.form;
        setForm(stored.form);
        setNotice("Recovered your unfinished changes from this browser.");
        if (
          initialItem &&
          stored.revision !== initialItem.revision &&
          stored.mutationId !== initialItem.mutationId
        )
          setConflict(initialItem);
      }
      if (
        !initialItem &&
        stored?.creation?.creationId &&
        contentFormSchema.safeParse(stored.creation.form).success
      )
        creation.current = stored.creation;
    } catch {
      setNotice(
        "Browser recovery could not be read. Your saved draft is still available.",
      );
    }
    setReady(true);
    return () => {
      alive.current = false;
    };
  }, [storageKey]);
  function edit(next: ContentForm) {
    formRef.current = next;
    setForm(next);
    setError("");
    setNotice("");
    setRegenerate(false);
    backup();
  }
  function accept(next: ContentItem) {
    itemRef.current = next;
    setItem(next);
  }
  const dirty =
    JSON.stringify(form) !== JSON.stringify(item?.form ?? emptyForm);
  const currentPlan = !dirty && !!item?.plan;
  const running = item?.planning?.status === "running";

  async function persist(): Promise<ContentItem | null> {
    const parsed = contentFormSchema.safeParse(formRef.current);
    if (!parsed.success) {
      setError(
        "Add a title (3–160 characters), an explanation (10–2000 characters), and valid settings.",
      );
      return null;
    }
    const snapshot = JSON.stringify(formRef.current);
    const existing = itemRef.current;
    const body = existing
      ? (pendingSave.current ?? {
          revision: existing.revision,
          mutationId: crypto.randomUUID(),
          form: parsed.data,
        })
      : (creation.current ?? {
          creationId: crypto.randomUUID(),
          form: parsed.data,
        });
    if (existing) pendingSave.current = body as PendingSave;
    else creation.current = body as { creationId: string; form: ContentForm };
    backup();
    const response = await request(
      existing ? `/api/content/${existing.id}` : "/api/content",
      existing ? "PUT" : "POST",
      existing ? body : { mode: "manual", ...body },
    );
    if (!alive.current) return null;
    if (response.status === 409 || !response.item) {
      if (response.item) setConflict(response.item);
      setError(
        response.error ||
          "Another tab changed this draft. Compare the saved version below.",
      );
      return null;
    }
    const saved = response.item;
    const wroteCurrentForm =
      JSON.stringify(body.form) === JSON.stringify(parsed.data) &&
      snapshot === JSON.stringify(formRef.current);
    accept(saved);
    pendingSave.current = null;
    if (wroteCurrentForm) {
      formRef.current = saved.form;
      setForm(saved.form);
    }
    backup();
    if (!existing) {
      // Carry newer unsaved edits into the destination recovery key before routing.
      try {
        localStorage.setItem(
          `vidsutra:content:${userId}:${saved.id}`,
          JSON.stringify({
            form: formRef.current,
            revision: saved.revision,
            mutationId: null,
          }),
        );
        localStorage.removeItem(storageKey);
      } catch {
        /* The database draft is saved. */
      }
      router.replace(`/home/create/${saved.id}`);
    }
    setNotice(
      wroteCurrentForm
        ? "Draft saved."
        : "The earlier save completed. Your newer changes are still here; save again to include them.",
    );
    return wroteCurrentForm ? saved : null;
  }
  async function save() {
    if (busyRef.current || conflict) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await persist();
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not save. Retry to recover this save.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(quiet = false) {
    const existing = itemRef.current;
    if (!existing || busyRef.current || recoveringRef.current) return;
    recoveringRef.current = true;
    if (!quiet) {
      busyRef.current = true;
      setBusy(true);
    }
    try {
      const response = await request(`/api/content/${existing.id}`);
      if (!alive.current || !response.item) return;
      // Background status reads must neither swallow a Save click nor apply
      // an older response after a foreground save or planning request.
      if (quiet && (busyRef.current || itemRef.current !== existing)) return;
      if (response.item.revision !== existing.revision) {
        setConflict(response.item);
        setError(
          "Another tab saved a newer version. Choose which draft to keep.",
        );
      } else {
        accept(response.item);
        if (!quiet) setNotice("Recovered the latest saved planning state.");
      }
    } catch (error) {
      if (
        alive.current &&
        (!quiet || (!busyRef.current && itemRef.current === existing))
      )
        setError(
          error instanceof Error
            ? error.message
            : "Could not recover your draft.",
        );
    } finally {
      recoveringRef.current = false;
      if (!quiet) {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (!running || busy || conflict) return;
    const timer = setTimeout(() => {
      void recover(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [item, running, busy, conflict]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        JSON.stringify(formRef.current) !==
          JSON.stringify(itemRef.current?.form ?? emptyForm) ||
        pendingSave.current
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function plan(retry = false) {
    if (busyRef.current || conflict || !itemRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setRegenerate(false);
    try {
      let saved = itemRef.current;
      if (
        JSON.stringify(formRef.current) !== JSON.stringify(saved.form) ||
        pendingSave.current
      ) {
        const result = await persist();
        if (!result) return;
        saved = result;
      }
      const snapshot = JSON.stringify(formRef.current);
      const previous = saved.planning;
      const intent =
        retry && previous
          ? { requestId: previous.requestId, revision: saved.revision }
          : planningIntent.current?.revision === saved.revision
            ? planningIntent.current
            : { revision: saved.revision, requestId: crypto.randomUUID() };
      planningIntent.current = intent;
      accept({
        ...saved,
        plan: null,
        planning: {
          ...intent,
          sourceRevision: saved.revision,
          status: "running",
          error: null,
          retryAt: null,
          attempts: previous?.attempts ?? 1,
        },
      });
      const response = await request(
        `/api/content/${saved.id}/plan`,
        "POST",
        intent,
      );
      if (!alive.current) return;
      if (response.status === 409) {
        if (response.item) setConflict(response.item);
        throw new Error(
          response.error ||
            "The draft changed. Recover it before planning again.",
        );
      }
      if (response.item) {
        if (response.item.revision !== saved.revision) {
          setConflict(response.item);
          throw new Error(
            "Another tab changed the draft during planning. Choose your version below.",
          );
        }
        accept(response.item);
        if (response.item.planning?.status === "completed") {
          planningIntent.current = null;
          setNotice(
            snapshot === JSON.stringify(formRef.current)
              ? "Your script and visual plan are saved."
              : "A plan was saved for the previous settings. Save your changes and generate a new plan.",
          );
        }
      }
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "Connection lost. Recover the request before retrying.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function resolve(useServer: boolean) {
    if (!conflict) return;
    accept(conflict);
    pendingSave.current = null;
    planningIntent.current = null;
    if (useServer) {
      formRef.current = conflict.form;
      setForm(conflict.form);
    }
    setConflict(null);
    setError("");
    setNotice(
      useServer
        ? "Loaded the saved version."
        : "Your edits are kept. Save to apply them to the latest revision.",
    );
    backup();
  }
  return (
    <div className="creator">
      <Link className="creator-back" href="/home/ideas">
        <ArrowLeft size={14} /> Explore ideas
      </Link>
      <header className="creator-heading">
        <p className="dash-eyebrow">Your next explanation</p>
        <h1>
          {form.config.format === "reel"
            ? "Create an explainer Reel"
            : "Create an image post"}
          <span>.</span>
        </h1>
        <p>One topic. Your point of view. We’ll take care of the planning.</p>
      </header>
      <div className="creator-layout">
        <div className="creator-settings">
          <fieldset disabled={!ready || busy} className="creator-fields">
            <section className="creator-panel">
              <h2>
                <Layers3 size={16} /> Content format
              </h2>
              <div className="creator-choice-grid">
                <button
                  type="button"
                  aria-pressed={form.config.format === "reel"}
                  onClick={() => {
                    if (form.config.format === "reel") return;
                    edit({
                      ...form,
                      config: {
                        ...defaultConfig,
                        language: form.config.language,
                      },
                    });
                  }}
                >
                  <Video size={19} />
                  <strong>Animated Reel</strong>
                  <small>9:16 · 1080 × 1920</small>
                </button>
                <button
                  type="button"
                  aria-pressed={form.config.format === "image"}
                  onClick={() =>
                    edit({
                      ...form,
                      config: {
                        format: "image",
                        language: form.config.language,
                        visualStyle: "infographic",
                        duration: null,
                        voice: null,
                      },
                    })
                  }
                >
                  <ImageIcon size={19} />
                  <strong>Image post</strong>
                  <small>4:5 · 1080 × 1350</small>
                </button>
              </div>
            </section>
            <section className="creator-panel">
              <h2>
                <Sparkles size={16} /> Educational topic & objective
              </h2>
              <label>
                Title
                <input
                  maxLength={160}
                  value={form.brief.title}
                  onChange={(event) =>
                    edit({
                      ...form,
                      brief: { ...form.brief, title: event.target.value },
                    })
                  }
                  placeholder="How does the internet work?"
                />
              </label>
              <label>
                Opening hook
                <input
                  maxLength={300}
                  value={form.brief.hook}
                  onChange={(event) =>
                    edit({
                      ...form,
                      brief: { ...form.brief, hook: event.target.value },
                    })
                  }
                  placeholder="An optional spark of curiosity"
                />
              </label>
              <label>
                What should we explain?
                <textarea
                  maxLength={2000}
                  rows={5}
                  value={form.brief.summary}
                  onChange={(event) =>
                    edit({
                      ...form,
                      brief: { ...form.brief, summary: event.target.value },
                    })
                  }
                  placeholder="Describe the topic, audience, and what they should learn."
                />
              </label>
            </section>
            <section className="creator-panel">
              <h2>Language & narration</h2>
              <div className="creator-choice-grid">
                {(["en", "hi"] as const).map((language) => (
                  <button
                    type="button"
                    key={language}
                    aria-pressed={form.config.language === language}
                    onClick={() =>
                      edit({ ...form, config: { ...form.config, language } })
                    }
                  >
                    <strong>
                      {language === "en" ? "English" : "हिन्दी · Hindi"}
                    </strong>
                    <small>
                      {language === "en"
                        ? "Clear, conversational explanations"
                        : "Devanagari script & natural phrasing"}
                    </small>
                  </button>
                ))}
              </div>
              {form.config.format === "reel" && (
                <>
                  <h3>
                    <Clock3 size={14} /> Target duration
                  </h3>
                  <div className="creator-choice-grid three">
                    {([30, 60, 90] as const).map((duration) => (
                      <button
                        type="button"
                        key={duration}
                        aria-pressed={form.config.duration === duration}
                        onClick={() => {
                          if (form.config.format === "reel")
                            edit({
                              ...form,
                              config: { ...form.config, duration },
                            });
                        }}
                      >
                        <strong>{duration} sec</strong>
                        <small>
                          {duration === 30
                            ? "Quick take"
                            : duration === 60
                              ? "In-depth concept"
                              : "Masterclass"}
                        </small>
                      </button>
                    ))}
                  </div>
                  <h3>
                    <Mic size={14} /> Voice narration
                  </h3>
                  <div className="creator-choice-grid">
                    {(["viraj", "monika"] as const).map((voice) => (
                      <button
                        type="button"
                        key={voice}
                        aria-pressed={form.config.voice === voice}
                        onClick={() => {
                          if (form.config.format === "reel")
                            edit({
                              ...form,
                              config: { ...form.config, voice },
                            });
                        }}
                      >
                        <strong>{voiceLabels[voice].split(" · ")[0]}</strong>
                        <small>{voiceLabels[voice].split(" · ")[1]}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {form.config.format === "image" && (
                <p className="creator-muted">
                  Single-image posts use no voice or duration settings.
                </p>
              )}
            </section>
            <section className="creator-panel">
              <h2>
                <ImageIcon size={16} /> Visual direction
              </h2>
              <div className="creator-style">
                <span aria-hidden="true">✦</span>
                <div>
                  <strong>Illustrated infographic</strong>
                  <p>
                    Clear diagrams, concise labels, and motion that makes ideas
                    click.
                  </p>
                </div>
                <Check size={17} />
              </div>
            </section>
          </fieldset>
          <div className="creator-actions">
            <button
              className="dash-button dash-button-secondary"
              disabled={
                !ready ||
                busy ||
                !!conflict ||
                (!!item && !dirty && !pendingSave.current)
              }
              onClick={() => void save()}
            >
              {busy ? (
                <LoaderCircle className="spinner" size={15} />
              ) : (
                <Save size={15} />
              )}
              {item ? "Save draft" : "Create draft"}
            </button>
            {item && (
              <button
                className="dash-button dash-button-primary"
                disabled={!ready || busy || !!conflict || running}
                onClick={() =>
                  currentPlan ? setRegenerate(true) : void plan()
                }
              >
                <Sparkles size={15} />
                {running
                  ? "Planning…"
                  : currentPlan
                    ? "Regenerate plan"
                    : "Generate script & plan"}
              </button>
            )}
          </div>
          <p className="creator-save-state" role="status">
            {!ready
              ? "Restoring draft…"
              : busy
                ? "Working…"
                : dirty || pendingSave.current
                  ? "Unsaved changes · save your draft before leaving"
                  : item
                    ? "All changes saved"
                    : "Your draft will be saved when you continue."}
          </p>
          <p className="creator-footnote">
            <CircleHelp size={13} /> Planning saves the script, caption, and
            visual directions. Generate illustrations from the saved plan below.
            Speaking time will be measured when narration is generated.
          </p>
        </div>
        <aside className="creator-preview">
          <div className="creator-panel">
            <p className="dash-eyebrow">Your production brief</p>
            <div
              className={`creator-poster ${form.config.format}`}
              aria-label="Decorative format preview"
            >
              <div className="creator-orbit" aria-hidden="true">
                <span />
                <i />
                <b />
              </div>
              <span className="creator-poster-tag">
                {form.config.format === "reel"
                  ? "EXPLAINER REEL"
                  : "EDUCATIONAL POST"}
              </span>
              <h2>
                {form.brief.title ||
                  "A little curiosity. A whole new perspective."}
              </h2>
              <small>Decorative layout preview</small>
            </div>
            <dl>
              <div>
                <dt>Format</dt>
                <dd>
                  {form.config.format === "reel" ? "9:16 Reel" : "4:5 Image"}
                </dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{form.config.language === "hi" ? "Hindi" : "English"}</dd>
              </div>
              {form.config.format === "reel" && (
                <>
                  <div>
                    <dt>Target duration</dt>
                    <dd>{form.config.duration} seconds</dd>
                  </div>
                  <div>
                    <dt>Voice</dt>
                    <dd>
                      {form.config.voice === "viraj" ? "Viraj" : "Monika"}
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt>Style</dt>
                <dd>Illustrated infographic</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
      <div aria-live="polite">
        {notice && (
          <p className="creator-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="creator-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {conflict && (
        <section className="creator-error" role="alert">
          <h2>A newer draft was saved.</h2>
          <p>
            Your local edits are preserved. Saved title:{" "}
            <strong>{conflict.form.brief.title}</strong>
          </p>
          <details>
            <summary>Compare saved brief</summary>
            <p>{conflict.form.brief.summary}</p>
            <p>
              {conflict.form.config.format} · {conflict.form.config.language}
            </p>
          </details>
          <div className="creator-actions">
            <button
              className="dash-button dash-button-secondary"
              onClick={() => resolve(true)}
            >
              Load saved version
            </button>
            <button
              className="dash-button dash-button-primary"
              onClick={() => resolve(false)}
            >
              Keep my edits
            </button>
          </div>
        </section>
      )}
      {regenerate && (
        <section className="creator-panel creator-confirm">
          <p>
            Replace the saved plan with a fresh Gemini plan? Your brief and
            settings will stay saved.
          </p>
          <div className="creator-actions">
            <button
              className="dash-button dash-button-primary"
              onClick={() => {
                planningIntent.current = null;
                void plan();
              }}
            >
              Generate a new plan
            </button>
            <button
              className="dash-button dash-button-secondary"
              onClick={() => setRegenerate(false)}
            >
              Keep current plan
            </button>
          </div>
        </section>
      )}
      {item && (
        <section className="creator-panel creator-plan">
          <div className="creator-plan-heading">
            <div>
              <p className="dash-eyebrow">From a thought to a story</p>
              <h2>
                {form.config.format === "image"
                  ? "Your image composition plan"
                  : "Your script & visual plan"}
              </h2>
            </div>
            <button
              className="dash-subtle-button"
              disabled={busy}
              onClick={() => void recover()}
            >
              <RefreshCw size={14} /> Recover planning status
            </button>
          </div>
          {dirty ? (
            <p className="creator-muted">
              Your brief or settings have changed. Save them and generate a new
              plan; the previous plan will not be used.
            </p>
          ) : running ? (
            <p className="creator-muted">
              <LoaderCircle className="spinner" size={16} /> Gemini is shaping
              your explanation. This can take up to 40 seconds.
            </p>
          ) : item.planning?.status === "failed" ? (
            <div className="creator-error">
              <p>{item.planning.error}</p>
              <div className="creator-actions">
                <button
                  className="dash-button dash-button-secondary"
                  disabled={busy || item.planning.attempts >= 3}
                  onClick={() => void plan(true)}
                >
                  Retry planning request
                </button>
                {item.planning.attempts >= 3 && (
                  <button
                    className="dash-button dash-button-primary"
                    disabled={busy}
                    onClick={() => {
                      planningIntent.current = null;
                      void plan();
                    }}
                  >
                    Start a new plan
                  </button>
                )}
              </div>
            </div>
          ) : !currentPlan ? (
            <div className="creator-plan-empty">
              <Layers3 size={28} />
              <h3>Your story starts here.</h3>
              <p>
                Generate a complete script and visual directions from your saved
                brief.
              </p>
            </div>
          ) : null}
          {currentPlan && item.plan && (
            <>
              <div className="creator-plan-ready">
                <Check size={14} /> Plan saved · {item.plan.scenes.length}{" "}
                {form.config.format === "image" ? "composition" : "scenes"}
              </div>
              <h3>{item.plan.title}</h3>
              <ol className="creator-scenes">
                {item.plan.scenes.map((scene, index) => (
                  <li key={index}>
                    <div className="creator-scene-number">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <h3>{scene.title}</h3>
                      {scene.narration && (
                        <p className="creator-narration">{scene.narration}</p>
                      )}
                      <p>
                        <strong>On screen:</strong> {scene.onScreenText}
                      </p>
                      <details>
                        <summary>Visual direction</summary>
                        <p>{scene.visual}</p>
                      </details>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="creator-caption">
                <h3>Suggested Instagram caption</h3>
                <p>{item.plan.caption}</p>
              </div>
              <p className="creator-footnote">
                This is your saved production plan. Review its visuals below.
                Narration and video rendering are separate stages. Review
                factual accuracy before publishing your finished content.
              </p>
            </>
          )}
        </section>
      )}
      {item?.plan && item.planning?.status === "completed" && (
        <VisualStudio
          key={`${item.id}:${item.revision}:${item.planning.requestId}`}
          contentId={item.id}
          revision={item.revision}
          planRequestId={item.planning.requestId}
          format={item.form.config.format}
          enabled={!!currentPlan && !busy && !conflict}
        />
      )}
      <Link className="creator-back" href="/home">
        <ArrowRight size={14} /> Back to your dashboard
      </Link>
    </div>
  );
}
