"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartRunButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: "执行 PRD 接单体检并输出产品理解摘要" })
      });
      const result = (await response.json()) as { run?: { id: string }; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error ?? "无法启动生产批次");
      router.push(`/runs/${result.run.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法启动生产批次");
      setStarting(false);
    }
  }

  return (
    <div className="start-run-control">
      <button className="primary-button" type="button" onClick={start} disabled={starting}>
        {starting ? "正在创建批次…" : "启动 PRD 体检"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
