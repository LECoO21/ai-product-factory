import { mkdtempSync } from "node:fs";
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

type ScriptedAction = { toolCallId: string; toolName: string; args: Record<string, unknown> };

class ScriptedRoundDriver implements HarnessDriver {
  private round = 0;
  constructor(private readonly script: ScriptedAction[][]) {}
  async run(input: HarnessDriverRunInput) {
    const actions = this.script[this.round] ?? [];
    this.round += 1;
    for (const action of actions) await input.execute(action);
    return { kind: "completed" as const, summary: `round ${this.round} done` };
  }
  async steer() { return { accepted: true }; }
  async abort() { return { accepted: true }; }
}

const evidence = (toolCallId: string, passed: boolean): ScriptedAction => ({
  toolCallId,
  toolName: "evidence.register",
  args: { criterionId: "CG-06", kind: passed ? "final" : "first", passed }
});

const makeHarness = (records: SqliteHarnessRecordStore, script: ScriptedAction[][], maxRounds?: number) =>
  new FactoryHarness({
    records,
    verifier: new CompletionVerifier(records),
    ...(maxRounds === undefined ? {} : { maxRounds }),
    prepare: async (_task, run): Promise<PreparedHarnessRun> => ({
      driver: new ScriptedRoundDriver(script),
      prompt: "完成 CG-06",
      requiredCriteria: ["CG-06"],
      execute: async (call: ScriptedAction) => {
        if (call.toolName === "evidence.register") {
          const args = call.args as { criterionId: string; kind: string; passed: boolean };
          const item = records.registerEvidence({
            runId: run.id,
            criterionId: args.criterionId,
            kind: args.kind,
            observation: {},
            passed: args.passed
          });
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            status: "succeeded" as const,
            summary: "证据已登记",
            evidenceIds: [item.id],
            artifactIds: [],
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          };
        }
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          status: "succeeded" as const,
          summary: "ok",
          artifactIds: [],
          evidenceIds: [],
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        };
      }
    })
  });

const newRecords = () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-rounds-"));
  return { directory, records: new SqliteHarnessRecordStore(join(directory, "factory.sqlite")) };
};

describe("FactoryHarness 返工循环", () => {
  it("第一轮缺证据时自动跑第二轮并补齐，最终成功", async () => {
    const { records } = newRecords();
    const task = records.createTask("production-run", "完成 CG-06");
    const harness = makeHarness(records, [
      [evidence("r1", false)],
      [evidence("r2", true)]
    ]);

    const snapshot = await harness.run(task.id);

    expect(snapshot.status).toBe("succeeded");
    const rounds = records.listHarnessRounds(snapshot.id);
    expect(rounds.map((item) => item.round)).toEqual([1, 2]);
    expect(rounds[0]!.decision).toBe("continue");
    expect(rounds[0]!.missing).toEqual(["CG-06"]);
    expect(rounds[1]!.decision).toBe("complete");
  });

  it("轮数用尽后如实失败并说明几轮未达标", async () => {
    const { records } = newRecords();
    const task = records.createTask("production-run", "完成 CG-06");
    const harness = makeHarness(records, [
      [evidence("r1", false)],
      [evidence("r2", false)]
    ], 2);

    const snapshot = await harness.run(task.id);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.stopReason).toContain("2 轮仍未满足完成目标");
    const rounds = records.listHarnessRounds(snapshot.id);
    expect(rounds.map((item) => item.decision)).toEqual(["continue", "continue", "budget_exhausted"]);
  });
});
