export default function Loading() {
  return (
    <div className="page route-state-page" role="status" aria-live="polite">
      <span className="eyebrow">正在读取生产档案</span>
      <div className="route-state-card route-loading-card">
        <span className="route-state-pulse" aria-hidden="true" />
        <div>
          <h1>正在恢复工厂现场</h1>
          <p>项目、生产批次和事件仍以后端持久化记录为准，请稍候。</p>
        </div>
      </div>
    </div>
  );
}
