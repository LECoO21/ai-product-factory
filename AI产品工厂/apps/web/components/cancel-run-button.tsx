"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { abortProductionRun } from "@/features/production-run/api";
import { getErrorMessage } from "@/lib/api/client";

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("确定取消当前任务吗？已产生的记录会保留。")) return;
    setCancelling(true);
    setError(null);
    try {
      await abortProductionRun(runId, "产品负责人从首页取消", crypto.randomUUID());
      router.refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, "取消失败"));
      setCancelling(false);
    }
  }

  return (
    <div className="attention-cancel-control">
      <button className="secondary-button" type="button" onClick={() => void cancel()} disabled={cancelling}>
        {cancelling ? "取消中…" : "取消"}
      </button>
      {error ? <span className="attention-cancel-error" role="alert">{error}</span> : null}
    </div>
  );
}
