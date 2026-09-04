import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ProductProject } from "@factory/shared";
import {
  migrateFactoryDatabase,
  SqliteCodexRuntimeStore,
  SqliteHarnessRecordStore,
  SqliteProductionRunStore,
  SqliteProjectRegistry
} from "./index";

const createDatabasePath = (prefix: string): string =>
  join(mkdtempSync(join(tmpdir(), prefix)), "factory.sqlite");

const createProductWithHarness = (databasePath: string) => {
  const now = "2026-09-02T08:00:00.000Z";
  const project: ProductProject = {
    id: randomUUID(),
    name: "Thread cleanup test product",
    description: "Thread cleanup outbox test fixture",
    prd: "Delete all persisted Codex threads when this product flow ends.",
    workspacePath: null,
    status: "draft",
    profile: {
      userTasks: ["test"], interactionModes: ["test"], targetSurfaces: ["web"],
      executionTraits: ["request-response"], artifactKinds: ["digital-output"],
      dataTraits: ["test"], aiRole: "development-only", riskTraits: [],
      qualityModes: ["deterministic-tests"], deploymentTargets: ["local"], evidence: []
    },
    blueprint: {
      id: randomUUID(), version: 1, capabilityPacks: ["web-interface"], stages: [],
      assumptions: [], unsupportedCapabilities: [], generatedAt: now
    },
    createdAt: now,
    updatedAt: now
  };
  const projects = new SqliteProjectRegistry(databasePath);
  projects.save(project, {
    id: randomUUID(), projectId: project.id, type: "project.created", payload: {}, occurredAt: now
  });
  const runs = new SqliteProductionRunStore(databasePath);
  const productionRun = runs.create(project.id, "Exercise the cleanup outbox");
  const harnessRecords = new SqliteHarnessRecordStore(databasePath);
  const task = harnessRecords.createTask(productionRun.id, "Create one harness thread");
  const harnessRun = harnessRecords.createHarnessRun({
    productionRunId: productionRun.id,
    taskId: task.id,
    sessionPath: ".factory/sessions/thread-cleanup.jsonl",
    promptVersion: "factory-harness-v1.0.0",
    model: "account-default"
  });
  return { project, productionRun, harnessRun };
};

describe("SqliteCodexRuntimeStore", () => {
  it("masks account email and never persists credential-shaped command fields", () => {
    const databasePath = createDatabasePath("factory-codex-account-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    const email = "leco@example.com";
    const secret = "must-never-reach-sqlite";

    const snapshot = store.setAccountSnapshot({
      authenticated: true,
      accountType: "chatgpt",
      email,
      planType: "plus",
      requiresOpenaiAuth: false,
      capturedAt: "2026-09-02T08:00:00.000Z"
    });

    expect(snapshot).toMatchObject({
      authenticated: true,
      accountType: "chatgpt",
      emailHint: "l***@e***.com",
      planType: "plus",
      requiresOpenaiAuth: false,
      capturedAt: "2026-09-02T08:00:00.000Z"
    });
    expect(() =>
      store.createCommand({
        type: "account.login.start",
        payload: { nested: { accessToken: secret } }
      })
    ).toThrow(/敏感字段/);

    store.close();
    const databaseContents = readFileSync(databasePath).toString("utf8");
    expect(databaseContents).not.toContain(email);
    expect(databaseContents).not.toContain(secret);
  });

  it("persists attemptable image discovery separately from unavailable media Adapters", () => {
    const databasePath = createDatabasePath("factory-codex-capabilities-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    const capabilities = [
      {
        kind: "image" as const,
        status: "attemptable" as const,
        source: "codex-app-server:image-generation+codex-skill:imagegen",
        reason: "当前工位仍需产物验真"
      },
      {
        kind: "audio" as const,
        status: "unavailable" as const,
        source: null,
        reason: "tool_not_configured"
      },
      {
        kind: "model3d" as const,
        status: "unavailable" as const,
        source: null,
        reason: "tool_not_configured"
      }
    ];

    store.setCapabilitySnapshot({
      capabilities,
      capturedAt: "2026-09-02T08:10:00.000Z"
    });
    store.close();

    const reopened = new SqliteCodexRuntimeStore(databasePath);
    expect(reopened.getCapabilitySnapshot()).toMatchObject({
      capabilities,
      capturedAt: "2026-09-02T08:10:00.000Z"
    });
    reopened.close();
  });

  it("downgrades legacy available snapshots to attemptable when reopening existing data", () => {
    const databasePath = createDatabasePath("factory-codex-legacy-capabilities-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.close();
    const database = new Database(databasePath);
    const now = "2026-09-02T08:10:00.000Z";
    database.prepare(
      "INSERT INTO codex_capability_snapshot (id, capabilities_json, captured_at, updated_at) VALUES (1, ?, ?, ?)"
    ).run(JSON.stringify([{
      kind: "image",
      status: "available",
      source: "legacy-detection",
      reason: "legacy"
    }]), now, now);
    database.close();

    const reopened = new SqliteCodexRuntimeStore(databasePath);
    expect(reopened.getCapabilitySnapshot()?.capabilities).toEqual([
      expect.objectContaining({ kind: "image", status: "attemptable" })
    ]);
    reopened.close();
  });

  it("creates commands and allows only one worker to claim each command", () => {
    const databasePath = createDatabasePath("factory-codex-commands-");
    const firstStore = new SqliteCodexRuntimeStore(databasePath);
    const secondStore = new SqliteCodexRuntimeStore(databasePath);
    const created = firstStore.createCommand({
      type: "account.login.start",
      payload: { provider: "chatgpt" }
    });

    expect(created).toMatchObject({
      type: "account.login.start",
      payload: { provider: "chatgpt" },
      status: "pending",
      workerId: null
    });
    expect(firstStore.getCommand(created.id)).toEqual(created);
    expect(firstStore.claimNextCommand("worker-a")).toMatchObject({
      id: created.id,
      status: "running",
      workerId: "worker-a"
    });
    expect(secondStore.claimNextCommand("worker-b")).toBeNull();

    firstStore.close();
    secondStore.close();
  });

  it("persists controlled completed and failed command terminal states", () => {
    const databasePath = createDatabasePath("factory-codex-terminal-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    const login = store.createCommand({ type: "account.login.start", payload: {} });

    expect(() => store.completeCommand(login.id, {})).toThrow(/尚未领取/);
    store.claimNextCommand("worker-a");
    const completed = store.completeCommand(login.id, {
      loginId: "login-1",
      authUrl: "https://auth.openai.com/"
    });
    expect(completed).toMatchObject({
      status: "completed",
      result: { loginId: "login-1", authUrl: "https://auth.openai.com/" },
      error: null
    });
    expect(completed.completedAt).not.toBeNull();
    expect(store.completeCommand(login.id, { ignored: true })).toEqual(completed);
    expect(() => store.failCommand(login.id, "late failure")).toThrow(/已经完成/);

    const refresh = store.createCommand({ type: "account.refresh", payload: {} });
    store.claimNextCommand("worker-a");
    const failed = store.failCommand(refresh.id, "app_server_unavailable");
    expect(failed).toMatchObject({
      status: "failed",
      result: null,
      error: "app_server_unavailable"
    });
    expect(store.failCommand(refresh.id, "ignored failure")).toEqual(failed);
    expect(() => store.completeCommand(refresh.id, {})).toThrow(/已经失败/);
    store.close();
  });

  it("explicitly fails account commands left running by a crashed worker", () => {
    const databasePath = createDatabasePath("factory-codex-command-recovery-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    const crashed = store.createCommand({ type: "account.login.start", payload: {} });
    store.claimNextCommand("crashed-worker");
    const stillPending = store.createCommand({ type: "account.refresh", payload: {} });

    const recovered = store.failRunningCommandsForRecovery(
      "上次 Worker 中断，账户操作结果未知，请重试"
    );

    expect(recovered).toEqual([
      expect.objectContaining({
        id: crashed.id,
        status: "failed",
        workerId: "crashed-worker",
        result: null,
        error: "上次 Worker 中断，账户操作结果未知，请重试",
        completedAt: expect.any(String)
      })
    ]);
    expect(store.getCommand(stillPending.id)?.status).toBe("pending");
    expect(store.failRunningCommandsForRecovery("重复恢复")).toEqual([]);
    store.close();
  });

  it("upserts and restores project-thread and run-turn bindings", () => {
    const databasePath = createDatabasePath("factory-codex-bindings-");
    const store = new SqliteCodexRuntimeStore(databasePath);
    const firstThread = store.saveThreadBinding("project-1", "thread-1");
    const updatedThread = store.saveThreadBinding("project-1", "thread-2");
    const firstTurn = store.saveTurnBinding("run-1", "thread-2", "turn-1");
    const updatedTurn = store.saveTurnBinding("run-1", "thread-2", "turn-2");

    expect(updatedThread).toMatchObject({ scopeId: "project-1", threadId: "thread-2" });
    expect(updatedThread.createdAt).toBe(firstThread.createdAt);
    expect(updatedTurn).toMatchObject({ runId: "run-1", threadId: "thread-2", turnId: "turn-2" });
    expect(updatedTurn.createdAt).toBe(firstTurn.createdAt);
    store.close();

    const reopened = new SqliteCodexRuntimeStore(databasePath);
    expect(reopened.getThreadBinding("project-1")).toEqual(updatedThread);
    expect(reopened.getTurnBinding("run-1")).toEqual(updatedTurn);
    expect(reopened.deleteThreadBinding("project-1", "thread-stale")).toBe(false);
    expect(reopened.getThreadBinding("project-1")).toEqual(updatedThread);
    expect(reopened.deleteThreadBinding("project-1", "thread-2")).toBe(true);
    expect(reopened.getThreadBinding("project-1")).toBeNull();
    reopened.close();
  });

  it("enqueues the product thread and every harness thread exactly once", () => {
    const databasePath = createDatabasePath("factory-codex-thread-cleanup-");
    const { project, productionRun, harnessRun } = createProductWithHarness(databasePath);
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.saveThreadBinding(project.id, "thread-product");
    store.saveTurnBinding(productionRun.id, "thread-product", "turn-product");
    store.saveThreadBinding(`harness:${harnessRun.id}`, "thread-harness");
    store.saveTurnBinding(harnessRun.id, "thread-harness", "turn-harness");

    const first = store.enqueueProductThreadCleanups(project.id);
    const repeated = store.enqueueProductThreadCleanups(project.id);

    expect(first.map(({ scopeId, threadId }) => ({ scopeId, threadId }))).toEqual([
      { scopeId: project.id, threadId: "thread-product" },
      { scopeId: `harness:${harnessRun.id}`, threadId: "thread-harness" }
    ]);
    expect(repeated.map((job) => job.id)).toEqual(first.map((job) => job.id));
    const claimed = store.claimNextThreadCleanup("worker-a");
    expect(first.map((job) => job.id)).toContain(claimed?.id);
    expect(claimed).toMatchObject({
      status: "running",
      workerId: "worker-a",
      attempts: 1
    });
    store.close();
  });

  it("recovers cleanup jobs left running by a crashed worker", () => {
    const databasePath = createDatabasePath("factory-codex-cleanup-recovery-");
    const { project } = createProductWithHarness(databasePath);
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.saveThreadBinding(project.id, "thread-product");
    const [job] = store.enqueueProductThreadCleanups(project.id);
    store.claimNextThreadCleanup("worker-crashed");

    expect(store.recoverRunningThreadCleanups()).toEqual([
      expect.objectContaining({
        id: job?.id,
        status: "pending",
        workerId: null,
        attempts: 1
      })
    ]);
    expect(store.claimNextThreadCleanup("worker-restarted")).toMatchObject({
      id: job?.id,
      status: "running",
      workerId: "worker-restarted",
      attempts: 2
    });
    store.close();
  });

  it("reschedules a transient cleanup failure without removing bindings", () => {
    const databasePath = createDatabasePath("factory-codex-cleanup-retry-");
    const { project } = createProductWithHarness(databasePath);
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.saveThreadBinding(project.id, "thread-product");
    const [job] = store.enqueueProductThreadCleanups(project.id);
    store.claimNextThreadCleanup("worker-a");

    const retryAt = "2020-01-01T00:00:00.000Z";
    const pending = store.rescheduleThreadCleanup(job!.id, "x".repeat(2_500), retryAt);

    expect(pending).toMatchObject({
      id: job?.id,
      status: "pending",
      workerId: null,
      attempts: 1,
      nextAttemptAt: retryAt
    });
    expect(pending.lastError).toHaveLength(2_000);
    expect(store.getThreadBinding(project.id)?.threadId).toBe("thread-product");
    expect(store.claimNextThreadCleanup("worker-b")).toMatchObject({
      id: job?.id,
      status: "running",
      workerId: "worker-b",
      attempts: 2
    });
    store.close();
  });

  it("completes a cleanup by atomically removing its matching bindings and outbox job", () => {
    const databasePath = createDatabasePath("factory-codex-cleanup-complete-");
    const { project, productionRun } = createProductWithHarness(databasePath);
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.saveThreadBinding(project.id, "thread-product");
    store.saveTurnBinding(productionRun.id, "thread-product", "turn-product");
    store.saveTurnBinding("another-run", "thread-product", "another-turn");
    const [job] = store.enqueueProductThreadCleanups(project.id);
    store.claimNextThreadCleanup("worker-a");

    expect(store.completeThreadCleanup(job!.id)).toEqual({
      jobId: job?.id,
      scopeId: project.id,
      threadId: "thread-product",
      threadBindingDeleted: true,
      turnBindingsDeleted: 2
    });
    expect(store.getThreadBinding(project.id)).toBeNull();
    expect(store.getTurnBinding(productionRun.id)).toBeNull();
    expect(store.getTurnBinding("another-run")).toBeNull();
    expect(store.claimNextThreadCleanup("worker-b")).toBeNull();
    store.close();
  });

  it("does not remove a replacement thread binding while completing a stale cleanup", () => {
    const databasePath = createDatabasePath("factory-codex-cleanup-replaced-");
    const { project, productionRun } = createProductWithHarness(databasePath);
    const store = new SqliteCodexRuntimeStore(databasePath);
    store.saveThreadBinding(project.id, "thread-old");
    store.saveTurnBinding(productionRun.id, "thread-old", "turn-old");
    const [job] = store.enqueueProductThreadCleanups(project.id);
    store.claimNextThreadCleanup("worker-a");
    store.saveThreadBinding(project.id, "thread-new");
    store.saveTurnBinding("run-new", "thread-new", "turn-new");

    expect(store.completeThreadCleanup(job!.id)).toMatchObject({
      threadBindingDeleted: false,
      turnBindingsDeleted: 1
    });
    expect(store.getThreadBinding(project.id)?.threadId).toBe("thread-new");
    expect(store.getTurnBinding(productionRun.id)).toBeNull();
    expect(store.getTurnBinding("run-new")?.threadId).toBe("thread-new");
    expect(store.claimNextThreadCleanup("worker-b")).toBeNull();
    store.close();
  });

  it("applies migration 0003 repeatedly without changing existing rows", () => {
    const databasePath = createDatabasePath("factory-codex-migration-");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE preserved_v3 (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO preserved_v3 VALUES (?, ?)").run("one", "keep-me");

    const first = migrateFactoryDatabase(database, databasePath);
    const second = migrateFactoryDatabase(database, databasePath);

    expect(first.applied).toContain("0003-codex-app-server-runtime");
    expect(second.applied).toEqual([]);
    expect(database.prepare("SELECT * FROM preserved_v3").all()).toEqual([
      { id: "one", value: "keep-me" }
    ]);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'codex_%'")
        .all()
    ).toHaveLength(6);
    database.close();
  });
});
