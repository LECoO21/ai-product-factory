import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { SqliteHarnessRecordStore } from "@factory/records";

export type CompletionDecision =
  | { decision: "complete"; criterionResults: Array<{ criterionId: string; passed: true }>; evidenceIds: string[]; verifiedAt: string }
  | { decision: "continue" | "failed" | "blocked" | "waiting_user"; satisfied: string[]; missing: string[]; failed: string[]; nextAction: string };

export class CompletionVerifier {
  constructor(private readonly records: SqliteHarnessRecordStore) {}

  verify(runId: string, requiredCriteria: string[]): CompletionDecision {
    const evidence = this.records.listEvidence(runId);
    const artifacts = new Map(this.records.listArtifacts(runId).map((artifact) => [artifact.id, artifact]));
    const satisfied: string[] = [];
    const missing: string[] = [];
    const failed: string[] = [];
    const evidenceIds: string[] = [];

    for (const criterionId of requiredCriteria) {
      const passedEvidence = evidence.filter((item) => item.criterionId === criterionId && item.passed);
      if (passedEvidence.length === 0) {
        missing.push(criterionId);
        continue;
      }
      const intact = passedEvidence.every((item) => {
        if (!item.artifactId) return true;
        const artifact = artifacts.get(item.artifactId);
        if (!artifact || !existsSync(artifact.path)) return false;
        return createHash("sha256").update(readFileSync(artifact.path)).digest("hex") === artifact.sha256;
      });
      if (!intact) {
        failed.push(criterionId);
        continue;
      }
      satisfied.push(criterionId);
      evidenceIds.push(...passedEvidence.map((item) => item.id));
    }

    if (failed.length > 0) {
      return { decision: "failed", satisfied, missing, failed, nextAction: "重新生成并登记完整、hash 一致的真实产物" };
    }
    const pendingTools = this.records.listInvocations(runId).filter((tool) => tool.status === "started");
    if (pendingTools.length > 0) {
      return { decision: "continue", satisfied, missing: [...missing, "tool-results"], failed,
        nextAction: "等待所有工具调用产生唯一终态结果" };
    }
    if (missing.length > 0) {
      return { decision: "continue", satisfied, missing, failed, nextAction: `补齐下一项真实证据：${missing[0]}` };
    }
    return {
      decision: "complete",
      criterionResults: requiredCriteria.map((criterionId) => ({ criterionId, passed: true as const })),
      evidenceIds,
      verifiedAt: new Date().toISOString()
    };
  }
}
