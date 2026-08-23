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
      <div className="route-state-card route-error-card">
        <span className="route-error-mark" aria-hidden="true">
          !
        </span>
        <div>
          <h1>页面加载失败</h1>
          <button type="button" className="primary-button" onClick={reset}>
            重新读取
          </button>
        </div>
      </div>
    </div>
  );
}
