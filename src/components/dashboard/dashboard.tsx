"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Clock3,
  Film,
  House,
  ImageIcon,
  Camera as Instagram,
  Layers3,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Video,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { DashboardContent, DashboardData } from "@/lib/dashboard";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";

type User = { name: string; email: string; emailVerified: boolean };
type Panel =
  | "create"
  | "ideas"
  | "library"
  | "calendar"
  | "connection"
  | "account"
  | "help"
  | "navigation"
  | "content"
  | null;
const navigation: { label: string; panel: Panel; icon: LucideIcon }[] = [
  { label: "Overview", panel: null, icon: House },
  { label: "Create content", panel: "create", icon: Sparkles },
  { label: "Explore ideas", panel: "ideas", icon: Lightbulb },
  { label: "Content library", panel: "library", icon: Clapperboard },
  { label: "Publishing calendar", panel: "calendar", icon: CalendarDays },
  { label: "Connected accounts", panel: "connection", icon: Instagram },
  { label: "Settings", panel: "account", icon: Settings2 },
];

function when(value: string | null) {
  if (!value) return "Date not available";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function Dashboard({
  user,
  data,
  children,
  activePage = children ? "ideas" : "overview",
}: {
  user: User;
  data: DashboardData;
  children?: ReactNode;
  activePage?: "overview" | "ideas" | "create";
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<DashboardContent | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, refresh] = useTransition();
  const { data: session, isPending } = authClient.useSession();
  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/sign-in");
      router.refresh();
    }
  }, [session, isPending, router]);

  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const firstName = user.name.trim().split(/\s+/)[0];
  const connected = data.connection.status === "connected";
  const connectionLabel = connected
    ? "Instagram connected"
    : data.connection.status === "expired"
      ? "Reconnect Instagram"
      : "Instagram not connected";
  const remaining = data.allowance
    ? Math.max(0, data.allowance.limit - data.allowance.used)
    : null;
  const remainingPercent =
    data.allowance && data.allowance.limit > 0
      ? Math.min(100, (100 * remaining!) / data.allowance.limit)
      : 0;

  function open(next: Panel) {
    if (next === "ideas" || next === "create") {
      dialog.current?.close();
      router.push(next === "create" ? "/home/create" : "/home/ideas");
      return;
    }
    if (!next) {
      dialog.current?.close();
      router.replace("/home");
      return;
    }
    setPanel(next);
    setError("");
    if (!dialog.current?.open) dialog.current?.showModal();
  }
  function details(item: DashboardContent) {
    if (
      item.status === "draft" &&
      item.editable &&
      /^[a-f0-9]{24}$/i.test(item.id)
    ) {
      router.push(`/home/create/${item.id}`);
      return;
    }
    setSelected(item);
    open("content");
  }
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError("We couldn’t sign you out. Please try again.");
      else {
        router.replace("/sign-in");
        router.refresh();
      }
    } catch {
      setError("We couldn’t connect. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  function nav(mobile = false) {
    return (
      <nav
        className={mobile ? "dash-drawer-nav" : "dash-nav"}
        aria-label={mobile ? "Mobile studio navigation" : "Studio navigation"}
      >
        {navigation.map(({ label, panel: destination, icon: Icon }) => (
          <button
            type="button"
            key={label}
            className={`dash-nav-item${(activePage === "overview" && !destination) || destination === activePage ? " is-current" : ""}`}
            aria-current={
              (activePage === "overview" && !destination) ||
              destination === activePage
                ? "page"
                : undefined
            }
            onClick={() => open(destination)}
          >
            <Icon size={17} />
            <span>{label}</span>
            {destination &&
              destination !== "account" &&
              destination !== "ideas" &&
              destination !== "create" && (
                <small>
                  {destination === "library"
                    ? data.totalContent || "Soon"
                    : "Soon"}
                </small>
              )}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <div className="dash-workspace">
      <aside className="dash-sidebar">
        <Link className="dash-logo" href="/home" aria-label="VidSutra overview">
          <span className="dash-logo-mark">
            <BrandMark />
          </span>
          VidSutra<span>.ai</span>
          <small>Studio</small>
        </Link>
        {nav()}
        <div className="dash-sidebar-bottom">
          <span className="dash-beta">
            <span />
            Open beta
          </span>
          <div className="dash-mini-allowance">
            <div>
              <span>Generations</span>
              <strong>
                {remaining === null ? "Not assigned" : `${remaining} remaining`}
              </strong>
            </div>
            <div
              className={`dash-mini-track${remaining === null ? " is-unassigned" : ""}`}
            >
              <span style={{ width: `${remainingPercent}%` }} />
            </div>
            <p>
              {data.allowance?.resetsAt
                ? `Resets ${when(data.allowance.resetsAt)}`
                : data.allowance
                  ? "Usage updates as you create"
                  : "Your allowance will appear here"}
            </p>
          </div>
          <button className="dash-sidebar-user" onClick={() => open("account")}>
            <span className="dash-avatar">{initials}</span>
            <span>
              <strong>{user.name}</strong>
              <small>Your creative studio</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-topbar">
          <div className="dash-topbar-left">
            <button
              className="dash-mobile-menu dash-icon-button"
              aria-label="Open navigation"
              onClick={() => open("navigation")}
            >
              <Menu size={20} />
            </button>
            <Link className="dash-mobile-brand" href="/home">
              <BrandMark />
              VidSutra<span>.ai</span>
            </Link>
            <span className="dash-breadcrumb">
              Studio <span>/</span>{" "}
              <strong>
                {activePage === "create"
                  ? "Create content"
                  : activePage === "ideas"
                    ? "Explore ideas"
                    : "Overview"}
              </strong>
            </span>
            <button
              className={`dash-connection${connected ? " is-connected" : ""}`}
              onClick={() => open("connection")}
            >
              <span />
              {connectionLabel}
            </button>
          </div>
          <div className="dash-topbar-actions">
            <button
              className="dash-icon-button"
              aria-label="Refresh dashboard"
              title="Refresh dashboard"
              disabled={refreshing}
              onClick={() => refresh(() => router.refresh())}
            >
              <RefreshCw size={15} className={refreshing ? "spinner" : ""} />
            </button>
            <button
              className="dash-button dash-button-primary dash-topbar-create"
              onClick={() => open("create")}
            >
              <Plus size={15} />
              New explainer
            </button>
            <button
              className="dash-avatar dash-avatar-button"
              aria-label="Open your account"
              onClick={() => open("account")}
            >
              {initials}
            </button>
          </div>
        </header>

        <main id="main-content" className="dash-content">
          {children || (
            <>
              <section className="dash-heading">
                <div>
                  <p className="dash-eyebrow">
                    <span />
                    Your creative studio · Overview
                  </p>
                  <h1>Your next idea, brought to life.</h1>
                  <p className="dash-subtitle">
                    Welcome, {firstName}. Turn a little curiosity into something
                    worth sharing.
                  </p>
                  <button
                    className={`dash-mobile-status dash-connection${connected ? " is-connected" : ""}`}
                    onClick={() => open("connection")}
                  >
                    <span />
                    {connectionLabel}
                  </button>
                </div>
                <div className="dash-heading-actions">
                  <button
                    className="dash-button dash-button-primary"
                    onClick={() => open("create")}
                  >
                    <Sparkles size={16} />
                    Create content
                  </button>
                  <button
                    className="dash-button dash-button-secondary"
                    onClick={() => open("ideas")}
                  >
                    <Lightbulb size={16} />
                    Explore ideas
                  </button>
                </div>
              </section>

              <div className="dash-bento">
                <section
                  className="dash-panel dash-featured"
                  aria-labelledby="featured-title"
                >
                  <div className="dash-panel-top">
                    <span
                      className={`dash-pill${data.featured ? " is-mint" : " is-lavender"}`}
                    >
                      <span />
                      {data.featured
                        ? "Ready to review"
                        : "A space for your first story"}
                    </span>
                    <span className="dash-small-label">
                      <WandSparkles size={13} />
                      Made for curious minds
                    </span>
                  </div>
                  <div className="dash-featured-body">
                    <div
                      className={`dash-poster${data.featured ? " has-content" : ""}`}
                    >
                      {!data.featured && (
                        <img
                          src="/illustrations/studio-ocean.png"
                          alt="Abstract ocean depths with glowing violet connections"
                        />
                      )}
                      <div className="dash-poster-shade" />
                      <span className="dash-poster-format">
                        <Video size={11} />
                        {data.featured?.format === "image"
                          ? "Image post"
                          : "9:16 · Reel"}
                      </span>
                      <span className="dash-poster-symbol">
                        {data.featured ? (
                          <Clapperboard size={26} />
                        ) : (
                          <Sparkles size={26} />
                        )}
                      </span>
                      <span className="dash-poster-caption">
                        {data.featured
                          ? "Your completed creation"
                          : "A thought. A story. A little wonder."}
                      </span>
                    </div>
                    <div className="dash-featured-copy">
                      <div className="dash-format-tags">
                        <span>
                          {data.featured?.format === "image"
                            ? "Single image"
                            : "Animated explainers"}
                        </span>
                        <span>
                          {data.featured?.language || "English & Hindi"}
                        </span>
                      </div>
                      <h2 id="featured-title">
                        {data.featured?.title || "What will you explain first?"}
                      </h2>
                      <p>
                        {data.featured
                          ? "Your latest completed explanation is waiting. Review its details and keep building your collection."
                          : "A question you can’t stop thinking about. A concept worth making simple. Your next great explanation starts with an idea."}
                      </p>
                      <div className="dash-voice-note">
                        <span className="dash-voice-icon">
                          {data.featured?.format === "image" ? (
                            <ImageIcon size={17} />
                          ) : (
                            <Radio size={17} />
                          )}
                        </span>
                        <div>
                          <span>
                            {data.featured?.format === "image"
                              ? "One idea, beautifully explained."
                              : "Two voices. Your point of view."}
                          </span>
                          <strong>
                            {data.featured?.format === "image"
                              ? "Educational graphic"
                              : "Viraj & Monika"}
                          </strong>
                        </div>
                        {data.featured?.format !== "image" && (
                          <span className="dash-wave" aria-hidden="true">
                            ▂ ▅ ▃ ▇ ▄ ▆ ▂ ▅ ▃
                          </span>
                        )}
                      </div>
                      <button
                        className="dash-button dash-button-primary"
                        onClick={() =>
                          data.featured
                            ? details(data.featured)
                            : open("create")
                        }
                      >
                        {data.featured ? (
                          <Layers3 size={16} />
                        ) : (
                          <Plus size={16} />
                        )}{" "}
                        {data.featured
                          ? "View creation"
                          : "Create your first explanation"}
                        <ArrowRight size={15} />
                      </button>
                      <span className="dash-fine-print">
                        {data.featured
                          ? `Updated ${when(data.featured.updatedAt)}`
                          : "Illustration shown for inspiration. Your content will appear here."}
                      </span>
                    </div>
                  </div>
                </section>

                <div className="dash-right-column">
                  <section
                    className="dash-panel dash-progress"
                    aria-labelledby="progress-title"
                  >
                    <div className="dash-panel-top">
                      <h2 id="progress-title">
                        <Radio size={13} />
                        Generation activity
                      </h2>
                      <span
                        className={`dash-pill${data.activeJob ? " is-mint" : ""}`}
                      >
                        {data.activeJob?.status || "All quiet"}
                      </span>
                    </div>
                    {data.activeJob ? (
                      <div className="dash-active-job">
                        <h3>{data.activeJob.title}</h3>
                        <div className="dash-stage">
                          <span className="dash-stage-dot" />
                          {data.activeJob.stage || data.activeJob.status}
                        </div>
                        <div
                          className="dash-indeterminate"
                          aria-label="Generation is in progress"
                        />
                        <p>
                          You can safely leave this page. Refresh to check the
                          latest status.
                        </p>
                      </div>
                    ) : (
                      <div className="dash-queue-empty">
                        <span className="dash-orbit-icon">
                          <Clock3 size={22} />
                        </span>
                        <h3>No explanations in progress</h3>
                        <p>
                          When you start creating, follow your story’s progress
                          right here.
                        </p>
                      </div>
                    )}
                  </section>
                  <section
                    className="dash-panel dash-allowance"
                    aria-labelledby="allowance-title"
                  >
                    <div className="dash-panel-top">
                      <h2 id="allowance-title">
                        <Zap size={14} />
                        Your beta allowance
                      </h2>
                      <span className="dash-beta-label">Free beta</span>
                    </div>
                    <div className="dash-allowance-value">
                      {remaining === null ? (
                        <strong>Not assigned yet</strong>
                      ) : (
                        <>
                          <strong>{remaining}</strong>
                          <span>/ {data.allowance!.limit} remaining</span>
                        </>
                      )}
                    </div>
                    <div
                      className={`dash-allowance-track${remaining === null ? " is-unassigned" : ""}`}
                      role={remaining === null ? undefined : "progressbar"}
                      aria-label={
                        remaining === null
                          ? "Allowance is not assigned"
                          : "Generations remaining"
                      }
                      aria-valuenow={remaining ?? undefined}
                      aria-valuemin={remaining === null ? undefined : 0}
                      aria-valuemax={data.allowance?.limit || undefined}
                    >
                      <span style={{ width: `${remainingPercent}%` }} />
                    </div>
                    <p>
                      {data.allowance
                        ? `${data.allowance.used} generations used${data.allowance.resetsAt ? ` · Resets ${when(data.allowance.resetsAt)}` : ""}`
                        : "Your generation allowance will be shown when quotas are enabled. No limits have been assigned."}
                    </p>
                  </section>
                </div>
              </div>

              <section
                className="dash-panel dash-schedule"
                aria-labelledby="schedule-title"
              >
                <div className="dash-schedule-heading">
                  <span className="dash-schedule-icon">
                    <CalendarDays size={20} />
                  </span>
                  <div>
                    <h2 id="schedule-title">Upcoming publications</h2>
                    <p>
                      {data.upcoming.length
                        ? "Your next stories, ready for their moment."
                        : "A little planning goes a long way."}
                    </p>
                  </div>
                </div>
                {data.upcoming.length ? (
                  <div className="dash-upcoming-list">
                    {data.upcoming.map((post) => (
                      <div key={post.id}>
                        <span className="dash-pill is-amber">Scheduled</span>
                        <strong>{post.title}</strong>
                        <span>{when(post.scheduledFor)} IST</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dash-schedule-empty">
                    <span className="dash-empty-dot" />
                    <div>
                      <strong>Nothing scheduled yet</strong>
                      <p>
                        Scheduled posts will appear here once publishing is
                        connected.
                      </p>
                    </div>
                  </div>
                )}
                <button
                  className="dash-subtle-button"
                  onClick={() => open("calendar")}
                >
                  View schedule
                  <ArrowUpRight size={15} />
                </button>
              </section>

              <section className="dash-recent" aria-labelledby="recent-title">
                <div className="dash-section-heading">
                  <div>
                    <h2 id="recent-title">
                      Recent content <span>{data.totalContent}</span>
                    </h2>
                    <p>Your ideas, collected in one place.</p>
                  </div>
                  <button
                    className="dash-subtle-button"
                    onClick={() => open("library")}
                  >
                    View library
                    <ArrowRight size={15} />
                  </button>
                </div>
                {data.recentContent.length ? (
                  <div className="dash-content-grid">
                    {data.recentContent.map((item) => (
                      <button
                        className="dash-content-card"
                        key={item.id}
                        onClick={() => details(item)}
                      >
                        <div className={`dash-content-art ${item.format}`}>
                          <span className="dash-pill">
                            {item.format === "image" ? "Image post" : "Reel"}
                          </span>
                          {item.format === "image" ? (
                            <ImageIcon size={37} />
                          ) : (
                            <Film size={37} />
                          )}
                          <span
                            className={`dash-pill dash-card-status${item.status === "completed" ? " is-mint" : item.status === "failed" ? " is-error" : ""}`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="dash-content-card-copy">
                          <h3>{item.title}</h3>
                          <p>
                            {item.language} · {when(item.updatedAt)}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dash-empty-library">
                    <span className="dash-empty-library-icon">
                      <Layers3 size={28} />
                      <span>
                        <Plus size={12} />
                      </span>
                    </span>
                    <h3>Your first explanation starts here.</h3>
                    <p>
                      A Reel, a simple graphic, an idea worth sharing.
                      <br />
                      Everything you create will find a home in your library.
                    </p>
                    <button
                      className="dash-subtle-button"
                      onClick={() => open("create")}
                    >
                      Let’s make something
                      <Sparkles size={14} />
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          <footer className="dash-footer">
            <span>
              <ShieldCheck size={12} />A space for ideas worth explaining.
            </span>
            <button onClick={() => open("help")}>
              <CircleHelp size={13} />
              Need a hand?
            </button>
            <span>VidSutra.ai · Beta</span>
          </footer>
        </main>
      </div>

      <nav className="dash-mobile-bottom" aria-label="Quick navigation">
        <button
          aria-current={!children ? "page" : undefined}
          onClick={() => open(null)}
        >
          <House size={19} />
          <span>Overview</span>
        </button>
        <button onClick={() => open("create")}>
          <Plus size={20} />
          <span>Create</span>
        </button>
        <button onClick={() => open("library")}>
          <Clapperboard size={19} />
          <span>Library</span>
        </button>
        <button onClick={() => open("calendar")}>
          <CalendarDays size={19} />
          <span>Publishing</span>
        </button>
      </nav>

      <dialog
        ref={dialog}
        className={`dash-dialog${panel === "navigation" ? " is-navigation" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onClose={() => setPanel(null)}
        aria-labelledby="dash-dialog-title"
      >
        <div className="dash-dialog-body">
          <button
            className="dash-dialog-close dash-icon-button"
            aria-label="Close dialog"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            <X size={19} />
          </button>
          <div className="dash-eyebrow">Your creative studio</div>
          {panel === "navigation" ? (
            <>
              <h2 id="dash-dialog-title">Explore your studio</h2>
              {nav(true)}
            </>
          ) : panel === "account" ? (
            <>
              <h2 id="dash-dialog-title">Your account</h2>
              <p className="dash-dialog-subtitle">
                A little space to call your own.
              </p>
              <div className="dash-account-details">
                <span className="dash-avatar">{initials}</span>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <small>
                  {user.emailVerified ? "Email verified" : "Email not verified"}
                </small>
              </div>
              <p className="dash-dialog-note">
                Profile editing, email verification, and preferences will be
                added with account settings.
              </p>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
              <button
                className="dash-button dash-button-secondary"
                disabled={signingOut}
                onClick={signOut}
              >
                {signingOut ? (
                  <LoaderCircle className="spinner" size={16} />
                ) : (
                  <LogOut size={16} />
                )}
                Sign out
              </button>
            </>
          ) : panel === "create" ? (
            <>
              <h2 id="dash-dialog-title">An idea is all it takes.</h2>
              <p className="dash-dialog-subtitle">
                The next feature will turn your topics into complete
                explanations. Here’s what’s coming to your studio.
              </p>
              <div className="dash-format-options">
                <div>
                  <Video size={25} />
                  <h3>Animated Reel</h3>
                  <p>
                    30, 60, or 90 seconds.
                    <br />
                    English or Hindi. Your choice of voice.
                  </p>
                  <span className="dash-soon">Coming next</span>
                </div>
                <div>
                  <ImageIcon size={25} />
                  <h3>Image post</h3>
                  <p>
                    A single educational graphic.
                    <br />
                    One idea, beautifully explained.
                  </p>
                  <span className="dash-soon">Coming next</span>
                </div>
              </div>
              <p className="dash-dialog-note">
                Content generation isn’t connected yet. No generation or quota
                charge has been started.
              </p>
            </>
          ) : panel === "ideas" ? (
            <>
              <h2 id="dash-dialog-title">Curiosity looks good on you.</h2>
              <p className="dash-dialog-subtitle">
                AI topic suggestions are coming with Explore ideas. Until then,
                a few evergreen questions to spark a thought:
              </p>
              <ul className="dash-idea-list">
                <li>
                  <Lightbulb size={17} />
                  Why is the sky blue?
                </li>
                <li>
                  <Lightbulb size={17} />
                  How does the internet work?
                </li>
                <li>
                  <Lightbulb size={17} />
                  What makes a black hole?
                </li>
              </ul>
              <p className="dash-dialog-note">
                These are inspiration examples, not generated or saved content.
              </p>
            </>
          ) : panel === "library" ? (
            <>
              <h2 id="dash-dialog-title">Your content library</h2>
              <p className="dash-dialog-subtitle">
                {data.totalContent
                  ? `${data.totalContent} creations in your collection. Showing the latest ${data.recentContent.length}.`
                  : "Your collection is waiting for its first story."}
              </p>
              {data.recentContent.map((item) => (
                <button
                  key={item.id}
                  className="dash-list-item"
                  onClick={() => details(item)}
                >
                  <Clapperboard size={18} />
                  <span>
                    {item.title}
                    <small>
                      {item.language} · {item.status}
                    </small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              <p className="dash-dialog-note">
                The complete library, filters, and previews will be added with
                content creation.
              </p>
            </>
          ) : panel === "calendar" ? (
            <>
              <h2 id="dash-dialog-title">A moment for every story.</h2>
              <p className="dash-dialog-subtitle">
                {data.upcoming.length
                  ? "Your next scheduled posts, in Asia/Kolkata time."
                  : "You don’t have any scheduled publications yet."}
              </p>
              {data.upcoming.map((post) => (
                <div className="dash-list-item" key={post.id}>
                  <CalendarDays size={18} />
                  <span>
                    {post.title}
                    <small>{when(post.scheduledFor)} IST</small>
                  </span>
                </div>
              ))}
              <p className="dash-dialog-note">
                Scheduling, calendar views, and publication controls will be
                added after Instagram publishing is connected.
              </p>
            </>
          ) : panel === "connection" ? (
            <>
              <h2 id="dash-dialog-title">Your Instagram connection</h2>
              <div className="dash-connection-card">
                <Instagram size={29} />
                <div>
                  <strong>
                    {data.connection.username
                      ? `@${data.connection.username.replace(/^@/, "")}`
                      : "Instagram"}
                  </strong>
                  <span>{connectionLabel}</span>
                </div>
              </div>
              <p className="dash-dialog-subtitle">
                Account connection and reconnection will be added with Instagram
                publishing. You’ll review every post before it goes live.
              </p>
              <p className="dash-dialog-note">
                No account connection or publication has been initiated.
              </p>
            </>
          ) : panel === "content" && selected ? (
            <>
              <h2 id="dash-dialog-title">{selected.title}</h2>
              <div className="dash-detail-grid">
                <div>
                  Format
                  <strong>
                    {selected.format === "image" ? "Image post" : "Reel"}
                  </strong>
                </div>
                <div>
                  Language<strong>{selected.language}</strong>
                </div>
                <div>
                  Status<strong>{selected.status}</strong>
                </div>
                <div>
                  Updated<strong>{when(selected.updatedAt)}</strong>
                </div>
              </div>
              <p className="dash-dialog-note">
                Playback, downloads, regeneration, and publishing will be
                available with content previews.
              </p>
            </>
          ) : (
            <>
              <h2 id="dash-dialog-title">Make yourself at home.</h2>
              <p className="dash-dialog-subtitle">
                Your dashboard is the starting point. Creation, your library,
                and publishing will arrive one feature at a time.
              </p>
              <p className="dash-dialog-note">
                For account access help, contact the VidSutra team. Feedback
                tools will be added during beta.
              </p>
            </>
          )}
          <button
            className="dash-button dash-button-primary dash-dialog-done"
            onClick={() => dialog.current?.close()}
          >
            Back to overview
            <ArrowRight size={15} />
          </button>
        </div>
      </dialog>
    </div>
  );
}
