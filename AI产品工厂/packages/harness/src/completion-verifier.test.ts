import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore } from "@factory/records";
import { CompletionVerifier } from "./completion-verifier";

describe("CompletionVerifier", () => {
  it("refuses completion until passed evidence and intact artifacts exist", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-completion-"));
    const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
    const task = records.createTask("production-run", "verify");
    const run = records.createHarnessRun({
      productionRunId: "production-run", taskId: task.id, sessionPath: "session.jsonl",
      promptVersion: "1.0.0", model: "account-default"
    });
    const verifier = new CompletionVerifier(records);

    expect(verifier.verify(run.id, ["CG-06"]).decision).toBe("continue");
    const reportPath = join(directory, "report.txt");
    writeFileSync(reportPath, "passed");
    const artifact = records.registerArtifact({
      runId: run.id, kind: "test-report", path: reportPath, mimeType: "text/plain"
    });
    records.registerEvidence({
      runId: run.id, criterionId: "CG-06", kind: "test", artifactId: artifact.id,
      observation: { exitCode: 0 }, passed: true
    });
    expect(verifier.verify(run.id, ["CG-06"]).decision).toBe("complete");

    writeFileSync(reportPath, "tampered");
    const tampered = verifier.verify(run.id, ["CG-06"]);
    expect(tampered.decision).toBe("failed");
    if (tampered.decision === "complete") throw new Error("篡改产物不能通过完成验证");
    expect(tampered.failed).toContain("CG-06");
  });

  it("returns impossible when goal-impossible evidence is registered", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-completion-"));
    const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
    const task = records.createTask("production-run", "verify");
    const run = records.createHarnessRun({
      productionRunId: "production-run", taskId: task.id, sessionPath: "session.jsonl",
      promptVersion: "1.0.0", model: "account-default"
    });
    const verifier = new CompletionVerifier(records);

    records.registerEvidence({
      runId: run.id, criterionId: "CG-06", kind: "goal-impossible",
      observation: { goalImpossible: true }, passed: false
    });

    const decision = verifier.verify(run.id, ["CG-06"]);
    expect(decision.decision).toBe("impossible");
    if (decision.decision === "complete") throw new Error("目标不可能时不能判定完成");
    expect(decision.nextAction).toContain("不可达成");
  });
});
