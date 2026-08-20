import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ProductProject } from "@factory/shared";
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
});
