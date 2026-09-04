import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore } from "@factory/records";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const newRecords = () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-lease-"));
  return { directory, records: new SqliteHarnessRecordStore(join(directory, "factory.sqlite")) };
};

describe("Harness 租约与检查点", () => {
  it("任务认领后带租约，过期后被回收", async () => {
    const { records } = newRecords();
    const task = records.createTask("production-run", "长任务");

    const claimed = records.claimTask("worker-1", 1000);
    expect(claimed).not.toBeNull();
    expect(claimed!.workerId).toBe("worker-1");
    expect(claimed!.expiresAt).not.toBeNull();

    expect(records.recoverExpiredTasks().length).toBe(0);

    await sleep(1100);
    const recovered = records.recoverExpiredTasks();
    expect(recovered.length).toBe(1);
    expect(recovered[0]!.id).toBe(task.id);
    expect(recovered[0]!.status).toBe("pending");
    expect(recovered[0]!.workerId).toBeNull();
    expect(recovered[0]!.expiresAt).toBeNull();
  });

  it("续期延长租约，避免过期回收", () => {
    const { records } = newRecords();
    const task = records.createTask("production-run", "长任务");
    records.claimTask("worker-1", 1000);

    const renewed = records.renewTaskLease(task.id, 60_000);

    expect(renewed.expiresAt).not.toBeNull();
    expect(records.recoverExpiredTasks().length).toBe(0);
  });

  it("记录并读取检查点", () => {
    const { records } = newRecords();
    const task = records.createTask("production-run", "目标");
    const run = records.createHarnessRun({
      productionRunId: "production-run", taskId: task.id, sessionPath: "session.jsonl",
      promptVersion: "1.0.0", model: "account-default"
    });

    records.createCheckpoint({
      harnessRunId: run.id, kind: "round-completed", status: "safe", payload: { round: 2 }
    });

    const latest = records.getLatestCheckpoint(run.id);
    expect(latest).not.toBeNull();
    expect(latest!.kind).toBe("round-completed");
    expect(latest!.payload.round).toBe(2);
    expect(records.listCheckpoints(run.id).length).toBe(1);
  });
});
