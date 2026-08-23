import { describe, expect, it } from "vitest";
import type { ProductionRun } from "@factory/shared";
import { getEmptyRunPresentation } from "./run-presentation";

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
