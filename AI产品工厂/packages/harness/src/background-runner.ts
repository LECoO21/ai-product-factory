import { SqliteHarnessRecordStore } from "@factory/records";
import type { BackgroundJob } from "@factory/shared";
import { ControlledCommandRunner } from "./workspace";

export class BackgroundRunner {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly records: SqliteHarnessRecordStore,
    private readonly commands: ControlledCommandRunner
  ) {}

  start(input: {
    taskId: string;
    kind: string;
    program: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
  }): { job: BackgroundJob; finished: Promise<BackgroundJob> } {
    const job = this.records.createBackgroundJob({
      taskId: input.taskId,
      kind: input.kind,
      commandSummary: `${input.program} ${input.args[0] ?? ""}`.trim()
    });
    const controller = new AbortController();
    this.active.set(job.id, controller);
    this.records.updateBackgroundJob(job.id, "running");
    const finished = this.commands.run({ ...input, signal: controller.signal })
      .then((result) => {
        if (this.records.getBackgroundJob(job.id)?.status === "cancelled") {
          return this.records.getBackgroundJob(job.id)!;
        }
        return this.records.updateBackgroundJob(
          job.id,
          result.exitCode === 0 ? "succeeded" : "failed",
          result.exitCode
        );
      })
      .catch(() => {
        if (this.records.getBackgroundJob(job.id)?.status === "cancelled") {
          return this.records.getBackgroundJob(job.id)!;
        }
        return this.records.updateBackgroundJob(job.id, "failed", 1);
      })
      .finally(() => this.active.delete(job.id));
    return { job, finished };
  }

  get(jobId: string) {
    return this.records.getBackgroundJob(jobId);
  }

  cancel(jobId: string) {
    const job = this.records.getBackgroundJob(jobId);
    if (!job) throw new Error(`后台任务不存在：${jobId}`);
    if (!["queued", "running"].includes(job.status)) return job;
    this.active.get(jobId)?.abort();
    return this.records.updateBackgroundJob(jobId, "cancelled");
  }

  recoverAfterRestart() {
    return this.records.interruptOrphanedBackgroundJobs();
  }
}
