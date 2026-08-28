import { describe, expect, it } from "vitest";
import type { ProductionRun, RunEvent } from "@factory/shared";
import {
  getEmptyRunPresentation,
  getHarnessTestEvidence,
  getProductPrototype,
  getStageReviewGuidance,
  stripProductPrototype
} from "./run-presentation";
import { getRunStatusLabel } from "./labels";

const run = (status: ProductionRun["status"], error: string | null = null): ProductionRun => ({
  id: "run-1",
  projectId: "project-1",
  stage: "intake",
  objective: "生成产品理解",
  status,
  workerId: null,
  error,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:01:00.000Z"
});

describe("getEmptyRunPresentation", () => {
  it("shows the failure reason and retry instead of a processing message", () => {
    const state = getEmptyRunPresentation(
      run("failed", "AI 未生成可确认结果，请重新分析"),
      false,
      "15 分 22 秒"
    );

    expect(state.message).toBe("AI 未生成可确认结果，请重新分析");
    expect(state.message).not.toContain("正在处理");
    expect(state.showActivity).toBe(false);
    expect(state.canRetry).toBe(true);
  });

  it("shows elapsed time only while a run is ready or running", () => {
    expect(getEmptyRunPresentation(run("ready"), false, "12 秒").message).toContain("12 秒");
    expect(getEmptyRunPresentation(run("running"), false, "18 秒").message).toContain("18 秒");
  });
});

describe("getStageReviewGuidance", () => {
  it("binds stage-design review to the current product prototype", () => {
    const guidance = getStageReviewGuidance("stage-design", "/previews/takeout-v0.html");

    expect(guidance).toEqual({
      eyebrow: "开发计划与基础稿验收",
      title: "先检查下面的开发计划，再试用当前产品的基础 HTML",
      description: "开发计划和基础稿都符合预期后，再确认进入正式制作。",
      previewHref: "/previews/takeout-v0.html",
      previewLabel: "查看基础 HTML"
    });
  });

  it("does not show a review link without a product prototype", () => {
    expect(getStageReviewGuidance("stage-design", null)).toBeNull();
    expect(getStageReviewGuidance("intake", "/preview.html")).toBeNull();
  });
});

describe("product prototype artifacts", () => {
  const event = (payload: RunEvent["payload"]): RunEvent => ({
    sequence: 1,
    id: "event-1",
    runId: "run-1",
    type: "artifact.created",
    payload,
    occurredAt: "2026-08-23T00:00:00.000Z"
  });

  it("reads the current product HTML artifact instead of a factory demo", () => {
    expect(
      getProductPrototype([
        event({
          kind: "product-prototype-html",
          title: "外卖推荐基础稿",
          href: "/previews/takeout-v0.html"
        })
      ])
    ).toEqual({ title: "外卖推荐基础稿", href: "/previews/takeout-v0.html" });
  });

  it("ignores unrelated artifacts", () => {
    expect(getProductPrototype([event({ kind: "test-report", href: "/report.html" })])).toBeNull();
  });

  it("removes the embedded prototype source from the visible development plan", () => {
    const output = [
      "# 第一阶段开发计划",
      "<!-- PRODUCT_PROTOTYPE_START -->",
      "<!doctype html><html><body>prototype</body></html>",
      "<!-- PRODUCT_PROTOTYPE_END -->"
    ].join("\n");

    expect(stripProductPrototype(output)).toBe("# 第一阶段开发计划");
  });
});

describe("getRunStatusLabel", () => {
  it("names the exact object waiting for approval", () => {
    expect(getRunStatusLabel({ stage: "stage-design", status: "waiting_approval" })).toBe(
      "开发计划待确认"
    );
  });
});

describe("getHarnessTestEvidence", () => {
  it("recognizes CG-06 failed and passed evidence even when the model uses a generic kind", () => {
    const base = {
      runId: "harness-run",
      criterionId: "CG-06",
      kind: "test",
      artifactId: null,
      createdAt: "2026-08-26T00:00:00.000Z"
    };
    const failed = { ...base, id: "failed", observation: { exitCode: 1 }, passed: false };
    const passed = { ...base, id: "passed", observation: { exitCode: 0 }, passed: true };

    expect(getHarnessTestEvidence([failed, passed])).toEqual({ failed, passed });
  });
});
