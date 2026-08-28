import "server-only";
import { SqliteHarnessRecordStore } from "@factory/records";
import type { HarnessView } from "./harness-types";

export const getHarnessView = (productionRunId: string): HarnessView | null => {
  const records = new SqliteHarnessRecordStore();
  const run = records.getHarnessRunForProductionRun(productionRunId);
  if (!run) return null;
  const task = records.getTask(run.taskId);
  if (!task) return null;
  return {
    id: run.id,
    objective: task.objective,
    status: run.status,
    stopReason: run.stopReason,
    plan: records.getPlan(run.id),
    tools: records.listInvocations(run.id).slice(-20).map((tool) => ({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      permission: tool.permission,
      status: tool.status,
      summary: typeof tool.result?.summary === "string" ? tool.result.summary : null,
      startedAt: tool.startedAt
    })),
    artifacts: records.listArtifacts(run.id).map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256,
      size: artifact.size,
      status: artifact.status
    })),
    evidence: records.listEvidence(run.id)
  };
};
