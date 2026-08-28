import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import type { ProductProject, ProductionRun } from "@factory/shared";
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

const requireNextRun = (run: ProductionRun | null) => {
  expect(run).not.toBeNull();
  if (!run) throw new Error("测试需要下一生产批次");
  return run;
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
    const firstNext = requireNextRun(first.nextRun);
    const repeatedNext = requireNextRun(repeated.nextRun);

    expect(first.completedRun.status).toBe("succeeded");
    expect(firstNext.stage).toBe("adaptation");
    expect(firstNext.status).toBe("ready");
    expect(repeatedNext.id).toBe(firstNext.id);
    expect(runs.listForProject(project.id)).toHaveLength(2);
    const eventTypes = runs.events(intake.id).map((event) => event.type);
    expect(eventTypes).toContain("gate.approved");
    expect(eventTypes.filter((type) => type === "protocol.approval.resolved")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "protocol.turn.completed")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "protocol.checkpoint.created")).toHaveLength(1);
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
    const adaptation = requireNextRun(controller.approveAndContinue(intake.id).nextRun);
    appendConfirmableResult(runs, adaptation.id);
    runs.transition(adaptation.id, "waiting_approval");

    const first = controller.approveAndContinue(adaptation.id);
    const repeated = controller.approveAndContinue(adaptation.id);
    const firstNext = requireNextRun(first.nextRun);
    const repeatedNext = requireNextRun(repeated.nextRun);

    expect(first.completedRun.status).toBe("succeeded");
    expect(firstNext.stage).toBe("stage-design");
    expect(firstNext.status).toBe("ready");
    expect(repeatedNext.id).toBe(firstNext.id);
    expect(runs.listForProject(project.id)).toHaveLength(3);
    expect(runs.events(adaptation.id).map((event) => event.type)).toContain("gate.approved");
  });

  it("continues from an approved development plan to exactly one implementation run", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const stageDesign = runs.create(project.id, "生成第一阶段开发计划", "stage-design");
    appendConfirmableResult(runs, stageDesign.id);
    runs.append(stageDesign.id, "artifact.created", {
      kind: "product-prototype-html",
      title: "当前产品基础 HTML",
      href: "/previews/product-v0.html"
    });
    runs.transition(stageDesign.id, "waiting_approval");
    const controller = createProductionController(runs);

    const first = controller.approveAndContinue(stageDesign.id);
    const repeated = controller.approveAndContinue(stageDesign.id);
    const firstNext = requireNextRun(first.nextRun);
    const repeatedNext = requireNextRun(repeated.nextRun);

    expect(first.completedRun.status).toBe("succeeded");
    expect(firstNext.stage).toBe("implementation");
    expect(firstNext.status).toBe("ready");
    expect(repeatedNext.id).toBe(firstNext.id);
    expect(runs.listForProject(project.id)).toHaveLength(2);
  });

  it("continues from an approved product result to exactly one automated-quality run", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const implementation = runs.create(project.id, "制作第一版可运行产品", "implementation");
    appendConfirmableResult(runs, implementation.id);
    runs.append(implementation.id, "artifact.created", {
      kind: "product-prototype-html",
      title: "第一版产品",
      href: `/api/runs/${implementation.id}/prototype`,
      content: "<!doctype html><html><body><form><button>提交</button></form></body></html>"
    });
    runs.transition(implementation.id, "waiting_approval");
    const controller = createProductionController(runs);

    const first = controller.approveAndContinue(implementation.id);
    const repeated = controller.approveAndContinue(implementation.id);
    const firstNext = requireNextRun(first.nextRun);
    const repeatedNext = requireNextRun(repeated.nextRun);

    expect(first.completedRun.status).toBe("succeeded");
    expect(firstNext.stage).toBe("automated-quality");
    expect(firstNext.status).toBe("ready");
    expect(repeatedNext.id).toBe(firstNext.id);
    expect(runs.listForProject(project.id)).toHaveLength(2);
  });

  it("accepts a completed G6 Harness validation and stops before G7", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const implementation = runs.create(project.id, "验证最小 Harness", "implementation");
    appendConfirmableResult(runs, implementation.id);
    runs.append(implementation.id, "harness.completed", {
      harnessRunId: "harness-1",
      completionGoal: "CG-06"
    });
    runs.transition(implementation.id, "waiting_approval");

    const result = createProductionController(runs).approveAndContinue(implementation.id);

    expect(result.completedRun.status).toBe("succeeded");
    expect(result.nextRun).toBeNull();
    expect(runs.events(implementation.id)).toContainEqual(
      expect.objectContaining({ type: "gate.approved", payload: expect.objectContaining({ completed: true }) })
    );
  });

  it.each([
    ["automated-quality", "real-acceptance"],
    ["real-acceptance", "release-preparation"],
    ["release-preparation", "release-readiness"],
    ["release-readiness", "release-handoff"]
  ] as const)("continues from %s to %s", (currentStage, nextStage) => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const current = runs.create(project.id, `完成 ${currentStage}`, currentStage);
    appendConfirmableResult(runs, current.id);
    if (currentStage === "real-acceptance") {
      runs.append(current.id, "artifact.created", {
        kind: "product-prototype-html",
        title: "待验收产品",
        href: "/api/runs/source/prototype"
      });
    }
    runs.transition(current.id, "waiting_approval");

    const result = createProductionController(runs).approveAndContinue(current.id);

    expect(result.nextRun?.stage).toBe(nextStage);
    expect(result.nextRun?.status).toBe("ready");
  });

  it("completes the release flow as a candidate without starting a deployment", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workflow-"));
    const databasePath = join(directory, "factory.sqlite");
    const project = createProject(databasePath);
    const runs = new SqliteProductionRunStore(databasePath);
    const releasePlan = runs.create(project.id, "生成上线方案", "release-preparation");
    appendConfirmableResult(runs, releasePlan.id);
    runs.transition(releasePlan.id, "waiting_approval");
    const controller = createProductionController(runs);

    const readiness = requireNextRun(controller.approveAndContinue(releasePlan.id).nextRun);
    appendConfirmableResult(runs, readiness.id);
    runs.transition(readiness.id, "waiting_approval");
    const handoff = requireNextRun(controller.approveAndContinue(readiness.id).nextRun);
    appendConfirmableResult(runs, handoff.id);
    runs.transition(handoff.id, "waiting_approval");

    const first = controller.approveAndContinue(handoff.id);
    const repeated = controller.approveAndContinue(handoff.id);

    expect(first.completedRun.status).toBe("succeeded");
    expect(first.nextRun).toBeNull();
    expect(repeated.nextRun).toBeNull();
    expect(runs.listForProject(project.id).map((run) => run.stage)).toEqual(
      expect.arrayContaining(["release-preparation", "release-readiness", "release-handoff"])
    );
    expect(runs.listForProject(project.id)).toHaveLength(3);
    expect(new SqliteProjectRegistry(databasePath).get(project.id)?.status).toBe("candidate");
    expect(runs.events(handoff.id)).toContainEqual(
      expect.objectContaining({
        type: "gate.approved",
        payload: expect.objectContaining({
          gate: "release_handoff",
          completed: true,
          deploymentStarted: false,
          projectStatus: "candidate"
        })
      })
    );
    expect(runs.listForProject(project.id).flatMap((run) => runs.events(run.id)))
      .not.toContainEqual(expect.objectContaining({ type: "deployment.started" }));
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
