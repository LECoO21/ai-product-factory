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
      model: "deepseek-v4-flash"
    });
    if (run.status === "succeeded") return this.snapshot(run, task);

    this.options.records.updateTask(task.id, "in_progress");
    run = this.options.records.transitionHarnessRun(run.id, "running");
    let prepared: PreparedHarnessRun;
    try {
      prepared = await this.options.prepare(task, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Harness 准备失败";
      this.options.records.updateTask(task.id, "blocked", message);
      run = this.options.records.transitionHarnessRun(run.id, "blocked", message);
      return this.snapshot(run, this.options.records.getTask(task.id)!);
    }

    this.active.set(run.id, prepared.driver);
    let outcome: HarnessDriverOutcome;
    try {
      outcome = await prepared.driver.run({ prompt: prepared.prompt, execute: prepared.execute });
    } catch (error) {
      outcome = { kind: "failed", summary: error instanceof Error ? error.message : "Harness 执行失败" };
    } finally {
      this.active.delete(run.id);
    }

    if (outcome.kind === "aborted") {
      this.options.records.updateTask(task.id, "cancelled", outcome.summary);
      run = this.options.records.transitionHarnessRun(run.id, "cancelled", outcome.summary);
      return this.snapshot(run, this.options.records.getTask(task.id)!);
    }
    if (outcome.kind === "suspended") {
      run = this.options.records.transitionHarnessRun(run.id, "waiting_user", outcome.summary);
      return this.snapshot(run, this.options.records.getTask(task.id)!);
    }
    if (outcome.kind === "failed") {
      this.options.records.updateTask(task.id, "failed", outcome.summary);
      run = this.options.records.transitionHarnessRun(run.id, "failed", outcome.summary);
      return this.snapshot(run, this.options.records.getTask(task.id)!);
    }

    run = this.options.records.transitionHarnessRun(run.id, "verifying");
    const decision = this.options.verifier.verify(run.id, prepared.requiredCriteria);
    if (decision.decision === "complete") {
      this.options.records.updateTask(task.id, "completed");
      run = this.options.records.transitionHarnessRun(run.id, "succeeded", "completion_goal_satisfied");
    } else {
      const reason = [...decision.failed, ...decision.missing].join(", ") || decision.nextAction;
      this.options.records.updateTask(task.id, "failed", reason);
      run = this.options.records.transitionHarnessRun(run.id, "failed", reason);
    }
    return this.snapshot(run, this.options.records.getTask(task.id)!);
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
