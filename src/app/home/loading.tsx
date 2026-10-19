import "./dashboard.css";

export default function LoadingStudio() {
  return (
    <div
      className="dash-workspace dash-loading"
      role="status"
      aria-label="Loading your studio"
    >
      <aside className="dash-sidebar" aria-hidden="true">
        <div className="dash-skeleton dash-skeleton-logo" />
        <div className="dash-skeleton dash-skeleton-nav" />
      </aside>
      <div className="dash-main">
        <div className="dash-topbar">
          <span className="dash-eyebrow">Your creative studio</span>
        </div>
        <main id="main-content" className="dash-content">
          <h1>Opening your studio…</h1>
          <p className="dash-subtitle">Gathering your latest stories.</p>
          <div
            className="dash-bento"
            aria-hidden="true"
            style={{ marginTop: 28 }}
          >
            <div className="dash-panel dash-skeleton dash-skeleton-featured" />
            <div className="dash-right-column">
              <div className="dash-panel dash-skeleton" />
              <div className="dash-panel dash-skeleton" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
