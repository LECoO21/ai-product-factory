import type { FactoryTask, HarnessRun } from "@factory/shared";
import { SqliteHarnessRecordStore } from "@factory/records";
import type { CompletionVerifier } from "./completion-verifier";
import type { ToolResultEnvelope } from "./tool-gateway";

export type HarnessDriverOutcome =
  | { kind: "completed"; summary: string }
  | { kind: "aborted"; summary: string }
  | { kind: "failed"; summary: string }
  | { kind: "suspended"; summary: string };

export type HarnessToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type HarnessDriverRunInput = {
  prompt: string;
  execute(call: HarnessToolCall): Promise<ToolResultEnvelope>;
};

export interface HarnessDriver {
  run(input: HarnessDriverRunInput): Promise<HarnessDriverOutcome>;
  steer(message: string): Promise<{ accepted: boolean; reason?: string }>;
  abort(reason: string): Promise<{ accepted: boolean; reason?: string }>;
}

export type PreparedHarnessRun = {
  driver: HarnessDriver;
  prompt: string;
  requiredCriteria: string[];
  execute(call: HarnessToolCall): Promise<ToolResultEnvelope>;
};

export type HarnessRunSnapshot = HarnessRun & {
  objective: string;
  plan: ReturnType<SqliteHarnessRecordStore["getPlan"]>;
  artifacts: ReturnType<SqliteHarnessRecordStore["listArtifacts"]>;
  evidence: ReturnType<SqliteHarnessRecordStore["listEvidence"]>;
};

export type CommandReceipt = { accepted: boolean; harnessRunId: string; message: string };

export type FactoryHarnessOptions = {
  records: SqliteHarnessRecordStore;
  verifier: CompletionVerifier;
  prepare(task: FactoryTask, run: HarnessRun): Promise<PreparedHarnessRun>;
  maxRounds?: number;
};

export class FactoryHarness {
  private readonly active = new Map<string, HarnessDriver>();

  constructor(private readonly options: FactoryHarnessOptions) {}

  private snapshot(run: HarnessRun, task: FactoryTask): HarnessRunSnapshot {
    return {
      ...run,
      objective: task.objective,
      plan: this.options.records.getPlan(run.id),
      artifacts: this.options.records.listArtifacts(run.id),
      evidence: this.options.records.listEvidence(run.id)
    };
  }

  async run(taskId: string): Promise<HarnessRunSnapshot> {
    const task = this.options.records.getTask(taskId);
    if (!task) throw new Error(`Task 不存在：${taskId}`);
    let run = this.options.records.getHarnessRunForProductionRun(task.runId);
    run ??= this.options.records.createHarnessRun({
      productionRunId: task.runId,
      taskId: task.id,
      sessionPath: `harness-sessions/${task.runId}.jsonl`,
      promptVersion: "factory-harness-v1.0.0",
      model: "account-default"
    });
    if (run.status === "succeeded") return this.snapshot(run, task);

    this.options.records.updateTask(task.id, "in_progress");
    run = this.options.records.transitionHarnessRun(run.id, "running");
    const prepared = await this.prepareOrBlock(task, run);
    if (!prepared) {
      return this.snapshot(this.options.records.getHarnessRun(run.id)!, this.options.records.getTask(task.id)!);
    }
    return this.executeRounds(task, run, prepared, 1);
  }

  async resume(taskId: string): Promise<HarnessRunSnapshot> {
    const task = this.options.records.getTask(taskId);
    if (!task) throw new Error(`Task 不存在：${taskId}`);
    const run = this.options.records.getHarnessRunForProductionRun(task.runId);
    if (!run) throw new Error("Harness 运行不存在");
    if (run.status !== "waiting_user") throw new Error("当前没有等待审批的运行");

    const pending = this.options.records.listPendingApprovals(run.id);
    if (pending.length > 0) return this.snapshot(run, task);

    this.options.records.updateTask(task.id, "in_progress");
    const prepared = await this.prepareOrBlock(task, run);
    if (!prepared) {
      return this.snapshot(this.options.records.getHarnessRun(run.id)!, this.options.records.getTask(task.id)!);
    }
    const completedRounds = this.options.records.listHarnessRounds(run.id).length;
    return this.executeRounds(task, run, prepared, completedRounds + 1);
  }

  private async prepareOrBlock(task: FactoryTask, run: HarnessRun): Promise<PreparedHarnessRun | null> {
    try {
      return await this.options.prepare(task, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Harness 准备失败";
      this.options.records.updateTask(task.id, "blocked", message);
      this.options.records.transitionHarnessRun(run.id, "blocked", message);
      return null;
    }
  }

  private async executeRounds(
    task: FactoryTask,
    run: HarnessRun,
    prepared: PreparedHarnessRun,
    startRound: number
  ): Promise<HarnessRunSnapshot> {
    const maxRounds = this.options.maxRounds ?? 3;
    let prompt = prepared.prompt;
    let currentRun = run;

    for (let round = startRound; round <= maxRounds; round += 1) {
      this.active.set(currentRun.id, prepared.driver);
      let outcome: HarnessDriverOutcome;
      try {
        outcome = await prepared.driver.run({ prompt, execute: prepared.execute });
      } catch (error) {
        outcome = { kind: "failed", summary: error instanceof Error ? error.message : "Harness 执行失败" };
      } finally {
        this.active.delete(currentRun.id);
      }

      if (outcome.kind === "aborted") {
        this.options.records.updateTask(task.id, "cancelled", outcome.summary);
        currentRun = this.options.records.transitionHarnessRun(currentRun.id, "cancelled", outcome.summary);
        return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
      }
      if (outcome.kind === "suspended") {
        currentRun = this.options.records.transitionHarnessRun(currentRun.id, "waiting_user", outcome.summary);
        return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
      }
      if (outcome.kind === "failed") {
        this.options.records.updateTask(task.id, "failed", outcome.summary);
        currentRun = this.options.records.transitionHarnessRun(currentRun.id, "failed", outcome.summary);
        return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
      }

      const pendingApprovals = this.options.records.listPendingApprovals(currentRun.id);
      if (pendingApprovals.length > 0) {
        currentRun = this.options.records.transitionHarnessRun(currentRun.id, "waiting_user", "有待审批的重大动作");
        return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
      }

      currentRun = this.options.records.transitionHarnessRun(currentRun.id, "verifying");
      const decision = this.options.verifier.verify(currentRun.id, prepared.requiredCriteria);
      const decisionFields = decision.decision === "complete"
        ? { satisfied: [] as string[], missing: [] as string[], failed: [] as string[], nextAction: "" }
        : decision;
      this.options.records.recordHarnessRound({
        harnessRunId: currentRun.id,
        round,
        decision: decision.decision,
        satisfied: decisionFields.satisfied,
        missing: decisionFields.missing,
        failed: decisionFields.failed,
        nextAction: decisionFields.nextAction
      });
      this.options.records.createCheckpoint({
        harnessRunId: currentRun.id,
        kind: "round-verified",
        status: decision.decision,
        payload: {
          round,
          satisfied: decisionFields.satisfied,
          missing: decisionFields.missing,
          failed: decisionFields.failed
        }
      });

      if (decision.decision === "complete") {
        this.options.records.updateTask(task.id, "completed");
        currentRun = this.options.records.transitionHarnessRun(currentRun.id, "succeeded", "completion_goal_satisfied");
        return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
      }
      if (decision.decision === "continue") {
        prompt = this.buildContinuationPrompt(prepared.prompt, decision, round, maxRounds);
        continue;
      }
      const reason = [...decision.failed, ...decision.missing].join(", ") || decision.nextAction;
      this.options.records.updateTask(task.id, "failed", reason);
      currentRun = this.options.records.transitionHarnessRun(currentRun.id, "failed", reason);
      return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
    }

    const exhaustedReason = `${maxRounds} 轮仍未满足完成目标`;
    this.options.records.recordHarnessRound({
      harnessRunId: currentRun.id,
      round: maxRounds + 1,
      decision: "budget_exhausted",
      satisfied: [],
      missing: [],
      failed: [],
      nextAction: exhaustedReason
    });
    this.options.records.updateTask(task.id, "failed", exhaustedReason);
    currentRun = this.options.records.transitionHarnessRun(currentRun.id, "failed", exhaustedReason);
    return this.snapshot(currentRun, this.options.records.getTask(task.id)!);
  }

  private buildContinuationPrompt(
    originalPrompt: string,
    decision: { missing: string[]; failed: string[]; nextAction: string },
    round: number,
    maxRounds: number
  ): string {
    return [
      originalPrompt,
      "",
      `第 ${round} 轮检查未通过，需要继续：`,
      `- 仍缺证据：${decision.missing.length > 0 ? decision.missing.join("、") : "无"}`,
      `- 失败证据：${decision.failed.length > 0 ? decision.failed.join("、") : "无"}`,
      `- 下一步：${decision.nextAction}`,
      `这是第 ${round + 1}/${maxRounds} 轮。请只补齐上述缺口，复用已完成的工具结果，不要从头重做。`
    ].join("\n");
  }

  async steer(harnessRunId: string, message: string): Promise<CommandReceipt> {
    const driver = this.active.get(harnessRunId);
    if (!driver) return { accepted: false, harnessRunId, message: "当前没有可引导的活动运行" };
    const receipt = await driver.steer(message);
    return { accepted: receipt.accepted, harnessRunId, message: receipt.reason ?? "指令已送达" };
  }

  async abort(harnessRunId: string, reason: string): Promise<CommandReceipt> {
    const driver = this.active.get(harnessRunId);
    if (!driver) return { accepted: false, harnessRunId, message: "当前没有可停止的活动运行" };
    const receipt = await driver.abort(reason);
    return { accepted: receipt.accepted, harnessRunId, message: receipt.reason ?? "停止请求已送达" };
  }

  get(harnessRunId: string): HarnessRunSnapshot | null {
    const run = this.options.records.getHarnessRun(harnessRunId);
    if (!run) return null;
    const task = this.options.records.getTask(run.taskId);
    return task ? this.snapshot(run, task) : null;
  }
}
