import { NextResponse } from "next/server";
import { SqliteHarnessRecordStore, SqliteProductionRunStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

type ApprovalDecision = "approved" | "denied";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
) {
  return params.then(async ({ id, approvalId }) => {
    try {
      const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
      const decision = body.decision === "approved" || body.decision === "denied"
        ? (body.decision as ApprovalDecision)
        : null;
      if (!decision) {
        return apiError("HARNESS_APPROVAL_DECISION_REQUIRED", "需要提供 decision：approved 或 denied", 400);
      }

      const harnessRecords = new SqliteHarnessRecordStore();
      const approval = harnessRecords.getApprovalRequest(approvalId);
      if (!approval) {
        return apiError("HARNESS_APPROVAL_NOT_FOUND", "审批请求不存在", 404);
      }
      const harnessRun = harnessRecords.getHarnessRunForProductionRun(id);
      if (!harnessRun || harnessRun.id !== approval.harnessRunId) {
        return apiError("HARNESS_APPROVAL_MISMATCH", "审批请求不属于该生产批次", 400);
      }

      harnessRecords.decideApprovalRequest(approvalId, decision);

      const runs = new SqliteProductionRunStore();
      const run = runs.get(id);
      if (run && run.status === "waiting_approval") {
        runs.transition(id, "ready");
      }

      return NextResponse.json({ decision, approvalId }, { status: 201 });
    } catch (error) {
      return apiError(
        "HARNESS_APPROVAL_DECISION_FAILED",
        error instanceof Error ? error.message : "无法处理审批",
        400
      );
    }
  });
}
