import { describe, expect, it } from "vitest";
import type { ProductionRun, ProductionStage, RunEvent } from "@factory/shared";
import { buildReleaseHandoff, evaluateReleaseReadiness, type ReleaseHistoryItem } from "./release-flow";

const run = (stage: ProductionStage, status: ProductionRun["status"] = "succeeded"): ProductionRun => ({
  id: `run-${stage}`,
  projectId: "project-1",
  stage,
  objective: stage,
  status,
  workerId: null,
  error: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:01:00.000Z"
});

const item = (stage: ProductionStage, events: Array<[string, Record<string, unknown>?]>): ReleaseHistoryItem => ({
  run: run(stage),
  events: events.map(([type, payload = {}], index): RunEvent => ({
    sequence: index + 1,
    id: `${stage}-${index}`,
    runId: `run-${stage}`,
    type,
    payload,
    occurredAt: "2026-08-27T00:00:00.000Z"
  }))
});

const readyHistory = (): ReleaseHistoryItem[] => [
  item("implementation", [["artifact.created", { kind: "product-prototype-html" }]]),
  item("automated-quality", [["quality.completed", { passed: true }]]),
  item("real-acceptance", [["gate.approved"]]),
  item("release-preparation", [
    ["text.delta", { delta: "完整的上线方案，包含目标环境、配置、验收、回滚和明确未执行事项。" }]
  ])
];

describe("release flow", () => {
  it("passes only when product, quality, acceptance, plan and rollback evidence exist", () => {
    const result = evaluateReleaseReadiness(readyHistory());

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(6);
    expect(result.markdown).toContain("没有连接云平台");
  });

  it("blocks handoff when the release plan has no rollback arrangement", () => {
    const history = readyHistory();
    const plan = history.find((entry) => entry.run.stage === "release-preparation");
    if (!plan) throw new Error("测试缺少上线方案");
    plan.events[0]!.payload.delta = "这是一份内容足够长但没有失败恢复安排的上线方案。";

    expect(evaluateReleaseReadiness(history).passed).toBe(false);
  });

  it("generates a manual checklist and explicitly stops before publication", () => {
    const history = readyHistory();
    history.push(item("release-readiness", [["release.readiness.completed", { passed: true }]]));

    const handoff = buildReleaseHandoff(history, "测试产品");

    expect(handoff).toContain("待人工发布");
    expect(handoff).toContain("未执行 Git push、上传、部署、发布或回滚");
  });
});
