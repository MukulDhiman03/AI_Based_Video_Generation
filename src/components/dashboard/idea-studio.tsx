"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentItem } from "@/lib/content-creation";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Lightbulb,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  acceptsResult,
  categories,
  draftSchema,
  editDraft,
  ideaInputSchema,
  inputKey,
  type Draft,
  type DraftRecord,
  type IdeaInput,
  type IdeaRequest,
} from "@/lib/ideas";
import { drainDraftSaveQueue } from "@/lib/draft-save-queue";

type SaveOperation = {
  revision: number;
  mutationId: string;
  draft: Draft;
};
const initialInput: IdeaInput = {
  topic: "Technology & everyday science",
  category: "All topics",
  language: "en",
  format: "reel",
};
async function api<T>(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const data = await response.json();
  if (!response.ok && response.status !== 409)
    throw new Error(data.error || "Could not connect. Please retry.");
  return { status: response.status, data };
}
export function IdeaStudio({
  userId,
  initialDraft,
  initialRequest,
}: {
  userId: string;
  initialDraft: DraftRecord;
  initialRequest: IdeaRequest | null;
}) {
  const router = useRouter();
  const [openingContent, setOpeningContent] = useState(false);
  const openingContentRef = useRef(false);
  const savedMutation = useRef(initialDraft.mutationId);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [input, setInput] = useState<IdeaInput>(
    initialRequest?.input ?? initialInput,
  );
  const inputRef = useRef(input);
  const [result, setResult] = useState<IdeaRequest | null>(initialRequest);
  const requestId = useRef<string | null>(initialRequest?.requestId ?? null);
  const [requestBusy, setRequestBusy] = useState(false);
  const requestBusyRef = useRef(false);
  const [requestError, setRequestError] = useState("");
  const [draft, setDraft] = useState(initialDraft.draft);
  const draftRef = useRef(draft);
  const revision = useRef(initialDraft.revision);
  const saved = useRef(JSON.stringify(initialDraft.draft));
  const operation = useRef<SaveOperation | null>(null);
  const savingRef = useRef(false);
  const [saveState, setSaveState] = useState<
    "saved" | "unsaved" | "saving" | "error"
  >("saved");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<DraftRecord | null>(null);
  const conflictRef = useRef<DraftRecord | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [notice, setNotice] = useState("");
  const draftSection = useRef<HTMLElement>(null);
  const storageKey = `vidsutra:idea-draft:${userId}`;
  const requestKey = `vidsutra:idea-request:${userId}`;

  function backup() {
    if (!alive.current) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          draft: draftRef.current,
          revision: revision.current,
          mutationId: operation.current?.mutationId ?? null,
        }),
      );
      setBackupError("");
    } catch {
      setBackupError(
        "Browser recovery storage is unavailable. Keep this page open until your changes are saved.",
      );
    }
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const local = JSON.parse(raw);
        const parsed = draftSchema.safeParse(local.draft);
        if (parsed.success && JSON.stringify(parsed.data) !== saved.current) {
          draftRef.current = parsed.data;
          setDraft(parsed.data);
          setSaveState("unsaved");
          setNotice("Recovered your unfinished draft from this browser.");
          if (
            local.revision !== initialDraft.revision &&
            local.mutationId !== initialDraft.mutationId
          ) {
            conflictRef.current = initialDraft;
            setConflict(initialDraft);
          }
        }
      }
    } catch {
      setBackupError(
        "Could not read browser recovery data. Your saved database draft is loaded.",
      );
    }
    setHydrated(true);
    // Read recovery data once for this account; refreshes must not reset edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function updateDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    setSaveState("unsaved");
    setSaveError("");
    setNotice("");
    backup();
  }
  async function saveDraft() {
    return drainDraftSaveQueue(
      savingRef,
      saveOnce,
      () => alive.current && !conflictRef.current,
    );
  }
  async function saveOnce(): Promise<boolean> {
    if (
      !operation.current &&
      JSON.stringify(draftRef.current) === saved.current
    ) {
      setSaveState("saved");
      return false;
    }
    setSaveState("saving");
    setSaveError("");
    const pending = operation.current ?? {
      revision: revision.current,
      mutationId: crypto.randomUUID(),
      draft: structuredClone(draftRef.current),
    };
    operation.current = pending;
    backup();
    try {
      const response = await api<DraftRecord>("/api/idea-draft", {
        method: "PUT",
        body: JSON.stringify({
          revision: pending.revision,
          mutationId: pending.mutationId,
          draft: pending.draft,
        }),
      });
      if (!alive.current) return false;
      if (response.status === 409) {
        conflictRef.current = response.data;
        setConflict(response.data);
        setSaveState("error");
        setSaveError(
          "Another tab changed this draft. Choose which version to keep.",
        );
        return false;
      } else {
        revision.current = response.data.revision;
        savedMutation.current = response.data.mutationId;
        saved.current = JSON.stringify(response.data.draft);
        operation.current = null;
        const hasPendingEdits =
          JSON.stringify(draftRef.current) !== saved.current;
        setSaveState(hasPendingEdits ? "unsaved" : "saved");
        backup();
        return hasPendingEdits;
      }
    } catch (error) {
      if (!alive.current) return false;
      setSaveState("error");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Save failed. Retry to recover.",
      );
      return false;
    }
  }
  useEffect(() => {
    if (!hydrated || conflict || saveState !== "unsaved") return;
    const timer = setTimeout(() => {
      void saveDraft();
    }, 700);
    return () => clearTimeout(timer);
    // The save queue reads refs to avoid applying older edit snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saveState, hydrated, conflict]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        JSON.stringify(draftRef.current) !== saved.current ||
        operation.current
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function continueToContent() {
    if (
      openingContentRef.current ||
      saveState !== "saved" ||
      draftRef.current.review !== "approved" ||
      !savedMutation.current
    )
      return;
    openingContentRef.current = true;
    setOpeningContent(true);
    setSaveError("");
    try {
      const response = await api<{ item?: ContentItem; error?: string }>(
        "/api/content",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "idea",
            creationId: savedMutation.current,
            ideaRevision: revision.current,
          }),
        },
      );
      if (response.status === 409 || !response.data.item)
        throw new Error(
          response.data.error || "Could not open a content draft.",
        );
      router.push(`/home/create/${response.data.item.id}`);
    } catch (error) {
      if (alive.current)
        setSaveError(
          error instanceof Error
            ? error.message
            : "Could not open the draft. Retry to continue.",
        );
    } finally {
      openingContentRef.current = false;
      if (alive.current) setOpeningContent(false);
    }
  }
  function changeInput(next: IdeaInput) {
    setReplacement(null);
    inputRef.current = next;
    setInput(next);
    setRequestError("");
  }
  async function sendRequest(record: { requestId: string; input: IdeaInput }) {
    if (requestBusyRef.current) return;
    requestBusyRef.current = true;
    setRequestBusy(true);
    setRequestError("");
    try {
      const response = await api<{ request: IdeaRequest; error?: string }>(
        "/api/ideas",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: record.requestId,
            ...record.input,
          }),
        },
      );
      if (!alive.current) return;
      if (response.status === 409)
        throw new Error(
          response.data.error || "Generate a new request to continue.",
        );
      if (
        acceptsResult(
          inputRef.current,
          requestId.current,
          response.data.request,
        )
      ) {
        setResult(response.data.request);
        if (response.data.request.status === "completed") {
          try {
            localStorage.removeItem(requestKey);
          } catch {
            /* Server result remains recoverable. */
          }
        }
      }
    } catch (error) {
      if (
        alive.current &&
        requestId.current === record.requestId &&
        inputKey(inputRef.current) === inputKey(record.input)
      )
        setRequestError(
          error instanceof Error
            ? error.message
            : "Connection lost. Recover your request below.",
        );
    } finally {
      requestBusyRef.current = false;
      if (alive.current) setRequestBusy(false);
    }
  }
  function generate() {
    if (requestBusyRef.current) return;
    const parsed = ideaInputSchema.safeParse(inputRef.current);
    if (!parsed.success) {
      setRequestError("Enter a topic between 3 and 300 characters.");
      return;
    }
    setReplacement(null);
    const record = { requestId: crypto.randomUUID(), input: parsed.data };
    requestId.current = record.requestId;
    setResult({
      ...record,
      status: "running",
      ideas: [],
      error: null,
      retryAt: null,
    });
    try {
      localStorage.setItem(requestKey, JSON.stringify(record));
    } catch {
      /* Latest server request can still be recovered. */
    }
    void sendRequest(record);
  }
  async function recover(manual = true) {
    if (requestBusyRef.current) return;
    requestBusyRef.current = true;
    setRequestBusy(true);
    setRequestError("");
    const startedInput = inputKey(inputRef.current);
    const startedId = requestId.current;
    try {
      let pending: { requestId: string; input: IdeaInput } | null = null;
      try {
        pending = JSON.parse(localStorage.getItem(requestKey) || "null");
      } catch {
        /* Fall back to server history. */
      }
      const id = pending?.requestId ?? requestId.current;
      const response = await api<{ request: IdeaRequest | null }>(
        `/api/ideas${id ? `?requestId=${encodeURIComponent(id)}` : ""}`,
      );
      if (
        !alive.current ||
        inputKey(inputRef.current) !== startedInput ||
        requestId.current !== startedId
      )
        return;
      const recovered = response.data.request;
      if (recovered) {
        requestId.current = recovered.requestId;
        changeInput(recovered.input);
        setResult(recovered);
      } else if (pending && ideaInputSchema.safeParse(pending.input).success) {
        requestId.current = pending.requestId;
        changeInput(pending.input);
        setResult({
          ...pending,
          status: "failed",
          ideas: [],
          error: "The request did not reach the server. Retry to send it.",
          retryAt: null,
        });
      } else if (manual)
        setRequestError("There is no previous request to recover.");
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "Could not recover the request.",
      );
    } finally {
      requestBusyRef.current = false;
      if (alive.current) setRequestBusy(false);
    }
  }
  useEffect(() => {
    void recover(
      false,
    ); /* Restore request IDs after reload, including a lost POST response. */
  }, []);
  useEffect(() => {
    if (result?.status !== "running" || requestBusy) return;
    const timer = setTimeout(() => {
      const id = result.requestId;
      void api<{ request: IdeaRequest | null }>(`/api/ideas?requestId=${id}`)
        .then(({ data }) => {
          if (
            alive.current &&
            data.request &&
            acceptsResult(inputRef.current, requestId.current, data.request)
          )
            setResult(data.request);
        })
        .catch(() =>
          setRequestError(
            "Connection lost. Recover your request to check its status.",
          ),
        );
    }, 2500);
    return () => clearTimeout(timer);
  }, [result, requestBusy]);

  const fresh = result && acceptsResult(input, requestId.current, result);
  const canUse = fresh && result.status === "completed";
  const hasDraft = !!(draft.title || draft.hook || draft.summary);
  const [replacement, setReplacement] = useState<number | null>(null);
  function useIdea(index: number, confirmed = false) {
    if (!canUse || !result) return;
    if (hasDraft && !confirmed) {
      setReplacement(index);
      return;
    }
    const idea = result.ideas[index];
    updateDraft({
      title: idea.title,
      hook: idea.hook,
      summary: idea.summary,
      format: result.input.format,
      language: result.input.language,
      review: "pending",
      sourceRequestId: result.requestId,
      sourceIndex: index,
    });
    setReplacement(null);
    draftSection.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  function resolveConflict(useServer: boolean) {
    const server = conflictRef.current;
    if (!server) return;
    revision.current = server.revision;
    savedMutation.current = server.mutationId;
    saved.current = JSON.stringify(server.draft);
    operation.current = null;
    conflictRef.current = null;
    setConflict(null);
    setSaveError("");
    if (useServer) {
      draftRef.current = server.draft;
      setDraft(server.draft);
      setSaveState("saved");
    } else setSaveState("unsaved");
    backup();
  }
  return (
    <div className="idea-studio">
      <section className="idea-intro">
        <div className="dash-eyebrow">
          <span /> Curated by curiosity · Powered by Gemini
        </div>
        <h1>
          Explore explainer ideas<span>.</span>
        </h1>
        <p>
          Discover a question worth explaining. Shape it into something only you
          could make.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            generate();
          }}
        >
          <label className="idea-topic">
            <Lightbulb size={18} />
            <span className="idea-sr-only">
              What would you like to explore?
            </span>
            <input
              maxLength={300}
              minLength={3}
              required
              value={input.topic}
              onChange={(event) =>
                changeInput({ ...input, topic: event.target.value })
              }
              placeholder="Technology, everyday science, a little curiosity…"
            />
          </label>
          <div className="idea-preferences">
            <label>
              Language
              <select
                value={input.language}
                onChange={(event) =>
                  changeInput({
                    ...input,
                    language: event.target.value as IdeaInput["language"],
                  })
                }
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
            <label>
              Format
              <select
                value={input.format}
                onChange={(event) =>
                  changeInput({
                    ...input,
                    format: event.target.value as IdeaInput["format"],
                  })
                }
              >
                <option value="reel">Animated Reel</option>
                <option value="image">Image post</option>
              </select>
            </label>
            <button
              className="dash-button dash-button-primary"
              disabled={requestBusy}
              type="submit"
            >
              {requestBusy ? (
                <LoaderCircle className="spinner" size={16} />
              ) : (
                <Sparkles size={16} />
              )}{" "}
              {requestBusy ? "Finding your next idea…" : "Generate new ideas"}
            </button>
          </div>
          <div className="idea-categories" aria-label="Idea categories">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={input.category === category}
                onClick={() => changeInput({ ...input, category })}
              >
                {category}
              </button>
            ))}
          </div>
        </form>
      </section>
      <div className="idea-result-heading">
        <span>
          {canUse
            ? "Six fresh perspectives. Make one yours."
            : "A little inspiration goes a long way."}
        </span>
        <button
          type="button"
          className="dash-subtle-button"
          onClick={() => void recover()}
          disabled={requestBusy}
        >
          <RefreshCw size={14} /> Recover last request
        </button>
      </div>
      <div aria-live="polite">
        {requestError && (
          <p className="idea-alert" role="alert">
            {requestError}
          </p>
        )}
        {result && !fresh && (
          <p className="idea-alert">
            Your brief has changed. Generate new ideas to match it. Previous
            suggestions cannot replace your draft.
          </p>
        )}
        {fresh && result.status === "failed" && (
          <div className="idea-alert">
            <p>{result.error}</p>
            <button
              className="dash-button dash-button-secondary"
              disabled={requestBusy}
              onClick={() =>
                void sendRequest({
                  requestId: result.requestId,
                  input: result.input,
                })
              }
            >
              <RefreshCw size={14} /> Retry this request
            </button>
            <small>
              Retries reuse this request. If it already completed, the saved
              result is returned.
            </small>
          </div>
        )}
        {fresh && result.status === "running" && (
          <p className="idea-empty">
            <LoaderCircle className="spinner" size={20} /> Gemini is exploring
            your brief. You can keep editing your draft.
          </p>
        )}
        {!result && !requestBusy && (
          <div className="idea-empty">
            <Lightbulb size={30} />
            <h2>Start with a little curiosity.</h2>
            <p>Choose your topic above, or write your own idea below.</p>
          </div>
        )}
      </div>
      {fresh && result.status === "completed" && (
        <div className="idea-grid">
          {result.ideas.map((idea, index) => (
            <article className="idea-card" key={`${result.requestId}:${index}`}>
              <div className="idea-card-top">
                <span>{idea.category}</span>
                <small>IDEA · {String(index + 1).padStart(2, "0")}</small>
              </div>
              <div className={`idea-art idea-art-${index}`} aria-hidden="true">
                <span />
                <i />
                <b /> <Lightbulb size={36} />
              </div>
              <p className="idea-hook">{idea.hook}</p>
              <h2>{idea.title}</h2>
              <p className="idea-summary">{idea.summary}</p>
              <div className="idea-card-meta">
                {result.input.format === "reel"
                  ? "Animated Reel"
                  : "Image post"}
                <span>
                  {result.input.language === "hi" ? "Hindi" : "English"}
                </span>
              </div>
              <button
                className="idea-use"
                disabled={!hydrated}
                onClick={() => useIdea(index)}
              >
                Use Idea <ArrowRight size={15} />
              </button>
              {replacement === index && (
                <div
                  className="idea-replace"
                  role="group"
                  aria-label="Confirm draft replacement"
                >
                  <p>Replace the current draft with this idea?</p>
                  <button
                    className="dash-subtle-button"
                    onClick={() => useIdea(index, true)}
                  >
                    Replace draft
                  </button>
                  <button
                    className="dash-subtle-button"
                    onClick={() => setReplacement(null)}
                  >
                    Keep current draft
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <section
        className="idea-draft"
        ref={draftSection}
        id="draft"
        aria-labelledby="idea-draft-title"
      >
        <div className="idea-draft-heading">
          <div>
            <p className="dash-eyebrow">Make it your own</p>
            <h2 id="idea-draft-title">Your idea, ready for review.</h2>
          </div>
          <span className={`idea-save-status is-${saveState}`} role="status">
            {saveState === "saving" ? (
              <LoaderCircle className="spinner" size={14} />
            ) : saveState === "saved" ? (
              <Check size={14} />
            ) : (
              <Save size={14} />
            )}
            {!hydrated
              ? "Restoring draft…"
              : saveState === "saved"
                ? "All changes saved"
                : saveState === "saving"
                  ? "Saving…"
                  : saveState === "error"
                    ? "Needs attention"
                    : "Unsaved changes"}
          </span>
        </div>
        {notice && (
          <p className="idea-notice" role="status">
            {notice}
          </p>
        )}
        {backupError && (
          <p className="idea-alert" role="alert">
            {backupError}
          </p>
        )}
        {conflict ? (
          <div className="idea-alert" role="alert">
            <p>
              Another version was saved while you were editing. Your current
              edits are still here.
            </p>
            <p>
              <strong>Saved version:</strong>{" "}
              {conflict.draft.title || "Untitled draft"} ·{" "}
              {conflict.draft.review}
            </p>
            <details>
              <summary>Compare saved version</summary>
              <p>{conflict.draft.hook}</p>
              <p>{conflict.draft.summary}</p>
            </details>
            <div className="idea-review-actions">
              <button
                className="dash-button dash-button-secondary"
                onClick={() => resolveConflict(true)}
              >
                Load saved version
              </button>
              <button
                className="dash-button dash-button-primary"
                onClick={() => resolveConflict(false)}
              >
                Keep my draft
              </button>
            </div>
          </div>
        ) : (
          saveError && (
            <div className="idea-alert" role="alert">
              <p>{saveError}</p>
              <button
                className="dash-button dash-button-secondary"
                onClick={() => void saveDraft()}
              >
                <RefreshCw size={14} /> Retry save
              </button>
            </div>
          )
        )}
        <fieldset disabled={!hydrated}>
          <label>
            Title
            <input
              maxLength={160}
              value={draft.title}
              onChange={(event) =>
                updateDraft(editDraft(draft, { title: event.target.value }))
              }
              placeholder="A question worth explaining"
            />
          </label>
          <label>
            Opening hook
            <input
              maxLength={300}
              value={draft.hook}
              onChange={(event) =>
                updateDraft(editDraft(draft, { hook: event.target.value }))
              }
              placeholder="Give your audience a reason to stay curious"
            />
          </label>
          <label>
            What should this explain?
            <textarea
              rows={5}
              maxLength={2000}
              value={draft.summary}
              onChange={(event) =>
                updateDraft(editDraft(draft, { summary: event.target.value }))
              }
              placeholder="Outline the explanation, key points, and the story you want to tell."
            />
          </label>
          <div className="idea-draft-options">
            <label>
              Language
              <select
                value={draft.language}
                onChange={(event) =>
                  updateDraft(
                    editDraft(draft, {
                      language: event.target.value as Draft["language"],
                    }),
                  )
                }
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
            <label>
              Format
              <select
                value={draft.format}
                onChange={(event) =>
                  updateDraft(
                    editDraft(draft, {
                      format: event.target.value as Draft["format"],
                    }),
                  )
                }
              >
                <option value="reel">Animated Reel</option>
                <option value="image">Image post</option>
              </select>
            </label>
          </div>
          <div className="idea-review-bar">
            <span className={`idea-review-state is-${draft.review}`}>
              {draft.review === "approved"
                ? "Approved for the next step"
                : draft.review === "dismissed"
                  ? "Dismissed · draft kept for recovery"
                  : "Awaiting your review"}
            </span>
            <div className="idea-review-actions">
              <button
                className="dash-button dash-button-secondary"
                onClick={() => {
                  updateDraft({ ...draft, review: "pending" });
                  draftSection.current?.querySelector("input")?.focus();
                }}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                className="dash-button dash-button-secondary"
                disabled={!hasDraft}
                onClick={() => updateDraft({ ...draft, review: "dismissed" })}
              >
                <X size={14} /> Dismiss
              </button>
              <button
                className="dash-button dash-button-primary"
                disabled={!draft.title.trim() || !draft.summary.trim()}
                onClick={() => updateDraft({ ...draft, review: "approved" })}
              >
                <Check size={14} /> Approve idea
              </button>
            </div>
          </div>
        </fieldset>
        {draft.review === "approved" && (
          <div className="idea-handoff">
            <p>Your idea is approved. Choose your production settings next.</p>
            <button
              className="dash-button dash-button-primary"
              disabled={
                saveState !== "saved" ||
                !!conflict ||
                openingContent ||
                !hydrated
              }
              onClick={() => void continueToContent()}
            >
              {openingContent ? (
                <LoaderCircle className="spinner" size={14} />
              ) : (
                <ArrowRight size={14} />
              )}{" "}
              {openingContent ? "Opening your draft…" : "Continue to creation"}
            </button>
          </div>
        )}
        <p className="idea-footnote">
          <CircleHelp size={14} /> Review AI suggestions for accuracy. Approval
          saves your decision. Continue to creation to choose settings and plan
          your content.
        </p>
      </section>
    </div>
  );
}
