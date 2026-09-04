import { NextResponse } from "next/server";
import { SqliteHarnessRecordStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    try {
      const harnessRecords = new SqliteHarnessRecordStore();
      const harnessRun = harnessRecords.getHarnessRunForProductionRun(id);
      if (!harnessRun) return NextResponse.json({ approvals: [] });
      const approvals = harnessRecords.listPendingApprovals(harnessRun.id);
      return NextResponse.json({
        approvals: approvals.map((approval) => ({
          id: approval.id,
          toolName: approval.toolName,
          args: approval.args,
          status: approval.status,
          createdAt: approval.createdAt
        }))
      });
    } catch (error) {
      return apiError(
        "HARNESS_APPROVALS_READ_FAILED",
        error instanceof Error ? error.message : "无法读取待审批项",
        400
      );
    }
  });
}
