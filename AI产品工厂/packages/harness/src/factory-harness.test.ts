import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore } from "@factory/records";
import { CompletionVerifier } from "./completion-verifier";
import { createCoreToolDefinitions } from "./core-tools";
import {
  FactoryHarness,
  type HarnessDriver,
  type HarnessDriverRunInput
} from "./factory-harness";
import { ManualAuthority } from "./manual-authority";
import { ToolGateway, type ToolResultEnvelope } from "./tool-gateway";
import { ControlledCommandRunner, LocalWorkspace } from "./workspace";

const projectRoot = join(import.meta.dirname, "../../..");
const fixture = join(projectRoot, "tests/fixtures/harness-loop");

class FailureRepairDriver implements HarnessDriver {
  constructor(private readonly workspace: LocalWorkspace) {}
  async run(input: HarnessDriverRunInput) {
    const execute = (toolCallId: string, toolName: string, args: Record<string, unknown>) =>
      input.execute({ toolCallId, toolName, args });
    await execute("01", "manual.verify", { authorityVersion: "2026-08-25" });
    await execute("02", "manual.load", { stage: "v0.2-b" });
    await execute("03", "workplan.update", { items: [
      { id: "read", text: "读取", status: "completed" },
      { id: "repair", text: "失败后修复", status: "in_progress" }
    ] });
    const firstRead = await execute("04", "workspace.read", { path: "math.js" });
    const firstHash = (firstRead.data as { sha256: string }).sha256;
    await execute("05", "workspace.patch", {
      patch: "--- a/math.js\n+++ b/math.js\n@@ -1,1 +1,1 @@\n-export const add = (left, right) => left + right;\n+export const add = (left, right) => left - right;\n",
      expectedHashes: { "math.js": firstHash }
    });
    const failed = await execute("06", "test.run", { script: "test", cwd: "." });
    await execute("07", "evidence.register", {
      criterionId: "CG-06", kind: "first-test", artifactId: failed.artifactIds[0],
      observation: { exitCode: (failed.data as { exitCode: number }).exitCode }, passed: false
    });
    const secondRead = await execute("08", "workspace.read", { path: "math.js" });
    const secondHash = (secondRead.data as { sha256: string }).sha256;
    await execute("09", "workspace.patch", {
      patch: "--- a/math.js\n+++ b/math.js\n@@ -1,1 +1,1 @@\n-export const add = (left, right) => left - right;\n+export const add = (left, right) => left + right;\n",
      expectedHashes: { "math.js": secondHash }
    });
    const passed = await execute("10", "test.run", { script: "test", cwd: "." });
    const diff = await execute("11", "git.inspect", { operation: "diff" });
    await execute("12", "evidence.register", {
      criterionId: "CG-06", kind: "failure-repair-loop", artifactId: passed.artifactIds[0],
      observation: { exitCode: (passed.data as { exitCode: number }).exitCode,
        diffArtifactId: diff.artifactIds[0] }, passed: true
    });
    return { kind: "completed" as const, summary: "deterministic loop finished" };
  }
  async steer() { return { accepted: true }; }
  async abort() { return { accepted: true }; }
}

describe("FactoryHarness deterministic loop", () => {
  it("persists a real test failure, repairs it, retests and only then succeeds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-loop-"));
    const workspaceRoot = join(directory, "workspace");
    cpSync(fixture, workspaceRoot, { recursive: true });
    execFileSync("git", ["init"], { cwd: workspaceRoot });
    execFileSync("git", ["add", "."], { cwd: workspaceRoot });
    const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
    const task = records.createTask("production-run", "完成失败—修复—复测闭环");
    const workspace = new LocalWorkspace(workspaceRoot);

    const harness = new FactoryHarness({
      records,
      verifier: new CompletionVerifier(records),
      prepare: async (_task, run) => {
        const gateway = new ToolGateway({ records, workspaceRoot, p1Approved: true });
        createCoreToolDefinitions({
          authority: new ManualAuthority(projectRoot), workspace,
          commands: new ControlledCommandRunner(workspaceRoot), records,
          harnessRunId: run.id, taskId: task.id, reportRoot: join(directory, "reports", run.id),
          completionCriteria: ["CG-06"]
        }).forEach((definition) => gateway.register(definition));
        return {
          driver: new FailureRepairDriver(workspace),
          prompt: "按生产单完成确定性闭环",
          requiredCriteria: ["CG-06"],
          execute: (call: { toolCallId: string; toolName: string; args: Record<string, unknown> }): Promise<ToolResultEnvelope> =>
            gateway.execute({ harnessRunId: run.id, ...call })
        };
      }
    });

    const snapshot = await harness.run(task.id);
    expect(snapshot.status).toBe("succeeded");
    const persisted = records.getHarnessRun(snapshot.id)!;
    expect(persisted.status).toBe("succeeded");
    const evidence = records.listEvidence(snapshot.id);
    expect(evidence.find((item) => item.kind === "first-test")?.observation.exitCode).not.toBe(0);
    expect(evidence.find((item) => item.kind === "failure-repair-loop")?.observation.exitCode).toBe(0);
    expect(records.listInvocations(snapshot.id).map((item) => item.toolName)).toEqual([
      "manual.verify", "manual.load", "workplan.update", "workspace.read", "workspace.patch",
      "test.run", "evidence.register", "workspace.read", "workspace.patch", "test.run",
      "git.inspect", "evidence.register"
    ]);
  });
});
