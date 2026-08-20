"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("页面渲染失败", { digest: error.digest });
  }, [error.digest]);

  return (
    <div className="page route-state-page" role="alert">
      <span className="eyebrow">生产档案读取失败</span>
      <div className="route-state-card route-error-card">
        <span className="route-error-mark" aria-hidden="true">
          !
        </span>
        <div>
          <h1>工厂暂时无法打开这个页面</h1>
          <p>现有生产记录没有被当作空数据处理。请重新读取；如果仍然失败，再检查本地服务和数据库。</p>
          <button type="button" className="primary-button" onClick={reset}>
            重新读取
          </button>
        </div>
      </div>
    </div>
  );
}
