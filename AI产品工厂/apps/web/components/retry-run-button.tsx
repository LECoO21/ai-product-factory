"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
      const result = (await response.json()) as { run?: { id: string }; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error ?? "无法重新分析");
      router.push(`/runs/${result.run.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法重新分析");
      setRetrying(false);
    }
  }

  return (
    <div className="retry-run-control">
      <button className="primary-button" type="button" onClick={retry} disabled={retrying}>
        {retrying ? "正在重新开始…" : "重新分析"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
