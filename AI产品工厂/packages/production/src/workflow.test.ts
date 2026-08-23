import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import type { ProductProject } from "@factory/shared";
import { createProductionController } from "./index";

const createProject = (databasePath: string) => {
  const registry = new SqliteProjectRegistry(databasePath);
  const now = new Date().toISOString();
  const project: ProductProject = {
    id: randomUUID(),
    name: "确认流程测试",
    description: "验证用户确认后进入技术适配",
    prd: "做一个让产品负责人确认后继续生产的 Web 产品。",
    workspacePath: null,
    status: "draft",
    profile: {
      userTasks: ["test"], interactionModes: ["workflow"], targetSurfaces: ["web"],
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
  return project;
};

const appendConfirmableResult = (runs: SqliteProductionRunStore, runId: string) => {
  runs.append(runId, "text.delta", { delta: "这是一份已经完整生成、可供产品负责人确认的结果。" });
  runs.append(runId, "agent.completed", { messageCount: 2 });
};

describe("ProductionController", () => {
  it("persists intake approval and creates exactly one adaptation run", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const intake = runs.create(project.id, "生成产品理解摘要", "intake");
    appendConfirmableResult(runs, intake.id);
    runs.transition(intake.id, "waiting_approval");
    const controller = createProductionController(runs);

    const first = controller.approveAndContinue(intake.id);
    const repeated = controller.approveAndContinue(intake.id);

    expect(first.completedRun.status).toBe("succeeded");
    expect(first.nextRun.stage).toBe("adaptation");
    expect(first.nextRun.status).toBe("ready");
    expect(repeated.nextRun.id).toBe(first.nextRun.id);
    expect(runs.listForProject(project.id)).toHaveLength(2);
    expect(runs.events(intake.id).map((event) => event.type)).toContain("gate.approved");
  });

  it("continues from adaptation approval to exactly one stage-design run", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const intake = runs.create(project.id, "生成产品理解摘要", "intake");
    appendConfirmableResult(runs, intake.id);
    runs.transition(intake.id, "waiting_approval");
    const controller = createProductionController(runs);
    const adaptation = controller.approveAndContinue(intake.id).nextRun;
    appendConfirmableResult(runs, adaptation.id);
    runs.transition(adaptation.id, "waiting_approval");

    const first = controller.approveAndContinue(adaptation.id);
    const repeated = controller.approveAndContinue(adaptation.id);

    expect(first.completedRun.status).toBe("succeeded");
    expect(first.nextRun.stage).toBe("stage-design");
    expect(first.nextRun.status).toBe("ready");
    expect(repeated.nextRun.id).toBe(first.nextRun.id);
    expect(runs.listForProject(project.id)).toHaveLength(3);
    expect(runs.events(adaptation.id).map((event) => event.type)).toContain("gate.approved");
  });

  it("rejects approval when an Agent completed without producing a result", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const intake = runs.create(project.id, "生成产品理解摘要", "intake");
    runs.append(intake.id, "agent.completed", { messageCount: 2 });
    runs.transition(intake.id, "waiting_approval");

    expect(() => createProductionController(runs).approveAndContinue(intake.id)).toThrow(
      "AI 结果尚未生成，不能确认"
    );
  });

  it("retries the same stage after an Agent completed without a result", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const intake = runs.create(project.id, "生成产品理解摘要", "intake");
    runs.append(intake.id, "agent.completed", { messageCount: 2 });
    runs.transition(intake.id, "waiting_approval");

    const retried = createProductionController(runs).retryWithoutResult(intake.id);

    expect(runs.get(intake.id)?.status).toBe("failed");
    expect(retried.stage).toBe("intake");
    expect(retried.status).toBe("ready");
    expect(retried.objective).toBe(intake.objective);
  });
});
