export default function Loading() {
  return (
    <div className="page route-state-page" role="status" aria-live="polite">
      <div className="route-state-card route-loading-card">
        <span className="route-state-pulse" aria-hidden="true" />
        <div>
          <h1>正在加载</h1>
        </div>
      </div>
    </div>
  );
}
