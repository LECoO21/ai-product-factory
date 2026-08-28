import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore } from "@factory/records";
import { BackgroundRunner } from "./background-runner";
import { ControlledCommandRunner } from "./workspace";

describe("BackgroundRunner", () => {
  it("persists success and cancellation as unique terminal states", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-background-"));
    const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
    const task = records.createTask("run", "background");
    const runner = new BackgroundRunner(records, new ControlledCommandRunner(directory));

    const success = runner.start({ taskId: task.id, kind: "command", program: "node",
      args: ["-e", "process.stdout.write('ok')"], cwd: ".", timeoutMs: 10_000 });
    await success.finished;
    expect(records.getBackgroundJob(success.job.id)?.status).toBe("succeeded");

    const cancelled = runner.start({ taskId: task.id, kind: "command", program: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"], cwd: ".", timeoutMs: 20_000 });
    expect(runner.cancel(cancelled.job.id).status).toBe("cancelled");
    await cancelled.finished;
    expect(records.getBackgroundJob(cancelled.job.id)?.status).toBe("cancelled");
  });
});
