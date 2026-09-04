import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { hasConfirmableAgentResult, type ProductProject } from "@factory/shared";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "./index";

describe("SqliteProductionRunStore", () => {
  it("queues, claims, records and completes a production run", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-runs-"));
    const databasePath = join(directory, "factory.sqlite");
    const registry = new SqliteProjectRegistry(databasePath);
    const now = new Date().toISOString();
    const project: ProductProject = {
      id: randomUUID(),
      name: "测试产品",
      description: "生产批次测试",
      prd: "创建一个用于验证生产批次队列和事件持久化的 Web 产品项目。",
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
    registry.save(project, {
      id: randomUUID(), projectId: project.id, type: "project.created", payload: {}, occurredAt: now
    });
    const runs = new SqliteProductionRunStore(databasePath);

    const created = runs.create(project.id, "执行 PRD 体检");
    expect(created.status).toBe("ready");
    expect(runs.claimNext("worker-test")?.status).toBe("running");
    runs.append(created.id, "text.delta", { delta: "开始分析" });
    expect(runs.transition(created.id, "succeeded").status).toBe("succeeded");
    expect(runs.events(created.id).map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.created", "run.claimed", "text.delta", "run.succeeded"])
    );
  });

  it("turns runs abandoned by a crashed worker into explicit retryable failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-run-recovery-"));
    const databasePath = join(directory, "factory.sqlite");
    const registry = new SqliteProjectRegistry(databasePath);
    const now = new Date().toISOString();
    const project: ProductProject = {
      id: randomUUID(),
      name: "恢复测试产品",
      description: "验证 Worker 异常退出后的批次恢复",
      prd: "创建一个用于验证崩溃恢复的产品项目。",
      workspacePath: null,
      status: "draft",
      profile: {
        userTasks: ["test"], interactionModes: ["test"], targetSurfaces: ["web"],
        executionTraits: ["long-running"], artifactKinds: ["digital-output"],
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
    registry.save(project, {
      id: randomUUID(), projectId: project.id, type: "project.created", payload: {}, occurredAt: now
    });
    const runs = new SqliteProductionRunStore(databasePath);
    const abandoned = runs.create(project.id, "执行长任务");
    runs.claimNext("worker-before-crash");
    runs.append(abandoned.id, "text.delta", { delta: "已经生成了一段足够长但尚未安全提交的中间结果" });
    runs.append(abandoned.id, "agent.completed", {});

    const recovered = runs.recoverRunningRuns("worker-after-restart");

    expect(recovered).toEqual([
      expect.objectContaining({ id: abandoned.id, status: "failed", error: expect.stringContaining("异常退出") })
    ]);
    const events = runs.events(abandoned.id);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "run.recovered",
        payload: expect.objectContaining({
          previousWorkerId: "worker-before-crash",
          recoveredByWorkerId: "worker-after-restart",
          retryable: true
        })
      }),
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "worker_crash_recovered" })
      }),
      expect.objectContaining({ type: "run.failed" })
    ]));
    expect(hasConfirmableAgentResult(events)).toBe(false);
    expect(runs.recoverRunningRuns("worker-after-restart")).toEqual([]);
  });
});
