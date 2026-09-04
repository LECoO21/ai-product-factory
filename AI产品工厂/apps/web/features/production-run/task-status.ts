import type { ProductionRun } from "@factory/shared";

export type TaskStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "streaming"
  | "waiting_user"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "disconnected"
  | "stale";

type BackendRunStatus = ProductionRun["status"];

const knownStatuses = new Set<BackendRunStatus>([
  "ready",
  "running",
  "waiting_approval",
  "blocked",
  "succeeded",
  "failed",
  "cancelled"
]);

export function getTaskStatus(
  backendStatus: string,
  connection: { streamConnected?: boolean; streamDisconnected?: boolean } = {}
): TaskStatus {
  if (!knownStatuses.has(backendStatus as BackendRunStatus)) return "stale";
  if (["ready", "running"].includes(backendStatus) && connection.streamDisconnected) {
    return "disconnected";
  }
  if (backendStatus === "ready") return "queued";
  if (backendStatus === "running") {
    return connection.streamConnected ? "streaming" : "running";
  }
  if (backendStatus === "waiting_approval" || backendStatus === "blocked") {
    return "waiting_user";
  }
  return backendStatus as "succeeded" | "failed" | "cancelled";
}

export const isTerminalTaskStatus = (status: TaskStatus) =>
  status === "succeeded" || status === "failed" || status === "cancelled" || status === "waiting_user";

const presentations: Record<TaskStatus, { label: string; now: string; action: string }> = {
  idle: { label: "还未开始", now: "还没有创建生产任务。", action: "填写需求后开始。" },
  submitting: { label: "正在提交", now: "需求正在提交。", action: "请稍等，不要重复点击。" },
  queued: { label: "等待开始", now: "任务已经受理，正在等待开始。", action: "现在不用操作，页面会自动更新。" },
  running: { label: "正在制作", now: "AI 已经开始处理这一步。", action: "现在不用操作，可以继续停留或稍后回来。" },
  streaming: { label: "正在制作", now: "AI 正在处理这一步，页面会自动更新。", action: "现在不用操作，可以继续停留或稍后回来。" },
  waiting_user: { label: "等你确认", now: "这一步已有可检查的结果。", action: "请检查下面的结果，再决定是否继续。" },
  succeeded: { label: "已经完成", now: "这一步已经完成，结果和记录已保存。", action: "可以检查结果或返回产品档案。" },
  failed: { label: "处理失败", now: "这一步没有完成，已有记录仍然保留。", action: "查看原因；允许时可重新分析。" },
  cancelled: { label: "已经停止", now: "产品流程已终止，已有记录仍然保留。", action: "如需继续，请新建一个产品。" },
  disconnected: { label: "正在恢复连接", now: "页面暂时收不到最新进度，任务可能仍在继续。", action: "正在读取真实状态，请不要重复开始任务。" },
  stale: { label: "状态需要刷新", now: "当前状态无法确认。", action: "请刷新页面读取真实状态。" }
};

export const getTaskStatusPresentation = (status: TaskStatus) => presentations[status];
