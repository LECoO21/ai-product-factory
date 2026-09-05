"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play } from "lucide-react";
import { startProductionRun } from "@/features/production-run/api";
import { getErrorMessage } from "@/lib/api/client";

export function StartRunButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const result = await startProductionRun(projectId);
      router.push(`/runs/${result.run.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught, "无法启动生产批次"));
      setStarting(false);
    }
  }

  return (
    <div className="start-run-control">
      <button className="primary-button" type="button" onClick={start} disabled={starting}>
        <Play aria-hidden="true" />
        {starting ? "正在开始…" : "开始分析"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
