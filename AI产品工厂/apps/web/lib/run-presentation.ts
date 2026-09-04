import {
  getProductPrototype,
  stripProductPrototype,
  type Evidence,
  type ProductionRun,
  type ProductionStage
} from "@factory/shared";

export { getProductPrototype, stripProductPrototype };

export type EmptyRunPresentation = {
  message: string;
  canRetry: boolean;
  showActivity: boolean;
  statusOverride: string | null;
};

export type StageReviewGuidance = {
  eyebrow: string;
  title: string;
  description: string;
  previewHref: string;
  previewLabel: string;
};

export function getHarnessTestEvidence(evidence: Evidence[]) {
  const failed = evidence.find((item) => item.kind === "first-test") ??
    evidence.find((item) => item.criterionId === "CG-06" && !item.passed);
  const passed = evidence.find((item) => item.kind === "failure-repair-loop") ??
    evidence.find((item) => item.criterionId === "CG-06" && item.passed);
  return { failed, passed };
}

export function getStageReviewGuidance(
  stage: ProductionStage,
  previewHref: string | null
): StageReviewGuidance | null {
  if (stage !== "stage-design" || !previewHref) return null;
  return {
    eyebrow: "开发计划与基础稿验收",
    title: "先检查下面的开发计划，再试用当前产品的基础 HTML",
    description: "开发计划和基础稿都符合预期后，再确认进入正式制作。",
    previewHref,
    previewLabel: "查看基础 HTML"
  };
}

export function getEmptyRunPresentation(
  run: ProductionRun,
  resultIsConfirmable: boolean,
  elapsedLabel: string
): EmptyRunPresentation {
  if (
    (run.status === "waiting_approval" || run.status === "succeeded") &&
    !resultIsConfirmable
  ) {
    return {
      message: "AI 没有返回可确认结果。",
      canRetry: true,
      showActivity: false,
      statusOverride: "结果为空"
    };
  }

  switch (run.status) {
    case "ready":
      return {
        message: `等待 AI 开始 · 已等待 ${elapsedLabel}`,
        canRetry: false,
        showActivity: true,
        statusOverride: null
      };
    case "running":
      return {
        message: `AI 正在处理 · 已等待 ${elapsedLabel}`,
        canRetry: false,
        showActivity: true,
        statusOverride: null
      };
    case "blocked":
      return {
        message: run.error || "当前批次等待配置。",
        canRetry: true,
        showActivity: false,
        statusOverride: null
      };
    case "failed":
      return {
        message: run.error || "这一步失败，请重新分析。",
        canRetry: true,
        showActivity: false,
        statusOverride: null
      };
    case "cancelled":
      return {
        message: "产品流程已终止；如需继续，请新建产品。",
        canRetry: false,
        showActivity: false,
        statusOverride: null
      };
    case "waiting_approval":
    case "succeeded":
      return {
        message: "AI 结果已完成。",
        canRetry: false,
        showActivity: false,
        statusOverride: null
      };
  }
}
