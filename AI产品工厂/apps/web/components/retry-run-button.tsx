"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { retryProductionRun } from "@/features/production-run/api";
import { getErrorMessage } from "@/lib/api/client";

export function RetryRunButton({ runId, label = "重新分析" }: { runId: string; label?: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const result = await retryProductionRun(runId);
      router.push(`/runs/${result.run.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught, "无法重新分析"));
      setRetrying(false);
    }
  }

  return (
    <div className="retry-run-control">
      <button className="primary-button" type="button" onClick={retry} disabled={retrying}>
        <RotateCcw aria-hidden="true" />
        {retrying ? "正在重新开始…" : label}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
