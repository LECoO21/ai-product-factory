"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { abortProductionRun } from "@/features/production-run/api";
import { getErrorMessage } from "@/lib/api/client";

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("确定终止这个产品流程吗？已有记录会保留；如需继续，请新建产品。")) return;
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
        <X aria-hidden="true" />
        {cancelling ? "取消中…" : "取消"}
      </button>
      {error ? <span className="attention-cancel-error" role="alert">{error}</span> : null}
    </div>
  );
}
