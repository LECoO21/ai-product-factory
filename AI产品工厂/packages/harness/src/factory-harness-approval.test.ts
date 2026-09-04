import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore } from "@factory/records";
import { CompletionVerifier } from "./completion-verifier";
import {
  FactoryHarness,
  type HarnessDriver,
  type HarnessDriverRunInput,
  type PreparedHarnessRun
} from "./factory-harness";
import { ToolGateway } from "./tool-gateway";

class ApprovalDriver implements HarnessDriver {
  constructor(private readonly nextId: () => string) {}
  async run(input: HarnessDriverRunInput) {
    await input.execute({
      toolCallId: this.nextId(),
      toolName: "file.delete",
      args: { path: "important.txt" }
    });
    return { kind: "completed" as const, summary: "done" };
  }
  async steer() { return { accepted: true }; }
  async abort() { return { accepted: true }; }
}

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-approval-"));
  const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  const task = records.createTask("production-run", "需要审批的任务");
  let counter = 0;
  const nextId = () => `approval-${++counter}`;
  const makeHarness = () => new FactoryHarness({
    records,
    verifier: new CompletionVerifier(records),
    prepare: async (_task, run): Promise<PreparedHarnessRun> => {
      const gateway = new ToolGateway({ records, workspaceRoot, p1Approved: true });
      return {
        driver: new ApprovalDriver(nextId),
        prompt: "执行任务",
        requiredCriteria: [],
        execute: (call: { toolCallId: string; toolName: string; args: Record<string, unknown> }) =>
          gateway.execute({ harnessRunId: run.id, ...call })
      };
    }
  });
  return { records, task, makeHarness };
};

describe("FactoryHarness 危险动作审批", () => {
  it("P2 工具触发审批挂起并记录审批请求", async () => {
    const { records, task, makeHarness } = setup();
    const harness = makeHarness();

    const snapshot = await harness.run(task.id);

    expect(snapshot.status).toBe("waiting_user");
    expect(snapshot.stopReason).toBe("有待审批的重大动作");
    const pending = records.listPendingApprovals(snapshot.id);
    expect(pending.length).toBe(1);
    expect(pending[0]!.toolName).toBe("file.delete");
    expect(pending[0]!.status).toBe("pending");
  });

  it("批准后恢复，同一动作命中已批准决定", async () => {
    const { records, task, makeHarness } = setup();
    const harness = makeHarness();
    const first = await harness.run(task.id);
    const pending = records.listPendingApprovals(first.id);
    records.decideApprovalRequest(pending[0]!.id, "approved");

    const snapshot = await harness.resume(task.id);

    const second = records.listInvocations(snapshot.id).find((item) => item.toolCallId === "approval-2");
    expect(second?.status).toBe("succeeded");
    expect(second?.result?.summary).toContain("已获批准");
  });

  it("拒绝后恢复，同一动作返回 denied", async () => {
    const { records, task, makeHarness } = setup();
    const harness = makeHarness();
    const first = await harness.run(task.id);
    const pending = records.listPendingApprovals(first.id);
    records.decideApprovalRequest(pending[0]!.id, "denied");

    const snapshot = await harness.resume(task.id);

    const second = records.listInvocations(snapshot.id).find((item) => item.toolCallId === "approval-2");
    expect(second?.status).toBe("denied");
    expect(second?.result?.summary).toContain("已由产品负责人拒绝");
  });
});
