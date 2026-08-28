import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteHarnessRecordStore, migrateFactoryDatabase } from "./index";

describe("minimum Harness records", () => {
  it("applies numbered migrations repeatedly without changing existing rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-migration-"));
    const databasePath = join(directory, "factory.sqlite");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE preserved (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO preserved VALUES (?, ?)").run("one", "keep-me");

    const first = migrateFactoryDatabase(database, databasePath);
    const second = migrateFactoryDatabase(database, databasePath);

    expect(first.applied).toContain("0002-minimum-harness");
    expect(second.applied).toEqual([]);
    expect(database.prepare("SELECT * FROM preserved").all()).toEqual([
      { id: "one", value: "keep-me" }
    ]);
    expect(first.backupPath).not.toBeNull();
    expect(readFileSync(first.backupPath!, "utf8")).toBeTruthy();
  });

  it("claims one task once and persists plans, artifacts and immutable evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-harness-records-"));
    const databasePath = join(directory, "factory.sqlite");
    const store = new SqliteHarnessRecordStore(databasePath);
    const task = store.createTask("production-run", "修复 fixture", 2);

    expect(store.claimTask("worker-a")?.id).toBe(task.id);
    expect(store.claimTask("worker-b")).toBeNull();

    const harnessRun = store.createHarnessRun({
      productionRunId: "production-run",
      taskId: task.id,
      sessionPath: "harness-sessions/run.jsonl",
      promptVersion: "1.0.0",
      model: "deepseek-v4-flash"
    });
    store.replacePlan(harnessRun.id, [
      { id: "read", text: "读取文件", status: "in_progress" },
      { id: "test", text: "运行测试", status: "pending" }
    ]);
    expect(store.getPlan(harnessRun.id)).toHaveLength(2);

    const artifactPath = join(directory, "report.txt");
    writeFileSync(artifactPath, "real report");
    const artifact = store.registerArtifact({
      runId: harnessRun.id,
      kind: "test-report",
      path: artifactPath,
      mimeType: "text/plain",
      sourceToolCallId: "tool-1"
    });
    const evidence = store.registerEvidence({
      runId: harnessRun.id,
      criterionId: "CG-06",
      kind: "test",
      artifactId: artifact.id,
      observation: { exitCode: 1 },
      passed: false
    });

    expect(artifact.sha256).toHaveLength(64);
    expect(() =>
      store.registerEvidence({
        runId: harnessRun.id,
        criterionId: "CG-06",
        kind: "test",
        artifactId: artifact.id,
        observation: { exitCode: 0 },
        passed: true,
        id: evidence.id
      })
    ).toThrow(/不可覆盖/);
  });

  it("isolates model-provided plan ids between Harness runs", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-plan-ids-"));
    const store = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
    const firstTask = store.createTask("production-a", "first");
    const secondTask = store.createTask("production-b", "second");
    const firstRun = store.createHarnessRun({
      productionRunId: "production-a", taskId: firstTask.id,
      sessionPath: "a.jsonl", promptVersion: "1", model: "deepseek-v4-flash"
    });
    const secondRun = store.createHarnessRun({
      productionRunId: "production-b", taskId: secondTask.id,
      sessionPath: "b.jsonl", promptVersion: "1", model: "deepseek-v4-flash"
    });

    store.replacePlan(firstRun.id, [{ id: "wp-1", text: "first", status: "pending" }]);
    expect(() => store.replacePlan(secondRun.id, [
      { id: "wp-1", text: "second", status: "pending" }
    ])).not.toThrow();
    expect(store.getPlan(firstRun.id)[0]?.text).toBe("first");
    expect(store.getPlan(secondRun.id)[0]?.text).toBe("second");
  });
});
