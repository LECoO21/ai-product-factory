import type { ProductionRun } from "@factory/shared";

export type EmptyRunPresentation = {
  message: string;
  canRetry: boolean;
  showActivity: boolean;
  statusOverride: string | null;
};

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
        message: "这一步已取消。",
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
