import type { CapabilityPack, ProductProject, ProductionRun } from "@factory/shared";

export const capabilityLabels: Record<CapabilityPack, string> = {
  "web-interface": "Web 界面",
  "agent-runtime": "Agent 运行时",
  "long-running-task": "长任务",
  rag: "RAG",
  multimedia: "多媒体",
  "game-experience": "游戏体验",
  "accounts-and-tenancy": "账户与数据隔离",
  "high-risk-actions": "高风险动作",
  "realtime-communication": "实时通信"
};

export const statusLabels: Record<ProductProject["status"], string> = {
  draft: "等待范围确认",
  ready: "可开始生产",
  running: "正在生产",
  blocked: "存在阻塞",
  candidate: "发布候选",
  released: "已经发布"
};

export const runStatusLabels: Record<ProductionRun["status"], string> = {
  ready: "等待 Worker",
  running: "正在执行",
  blocked: "等待配置",
  succeeded: "执行完成",
  failed: "执行失败",
  cancelled: "已取消"
};

export const valueLabels: Record<string, string> = {
  web: "Web",
  mobile: "移动端",
  api: "API",
  undecided: "待确认",
  entertainment: "娱乐体验",
  "to-be-refined": "待 Agent 补全",
  "realtime-interaction": "实时交互",
  conversation: "多轮对话",
  "ai-assisted-workflow": "AI 工作流",
  "form-or-workflow": "表单或工作流",
  "interactive-loop": "交互循环",
  "long-running": "长任务",
  "request-response": "请求响应",
  "realtime-communication": "实时通信",
  multimedia: "多媒体",
  "digital-output": "数字产物",
  "retrieval-result": "检索结果",
  "user-owned-data": "用户归属数据",
  "recoverable-task-state": "可恢复任务状态",
  core: "产品核心能力",
  supporting: "辅助能力",
  "development-only": "仅用于生产过程",
  none: "不使用 AI",
  unknown: "待确认",
  local: "本地",
  "public-web": "公网 Web"
};

export const displayValues = (values: string[]) =>
  values.map((value) => valueLabels[value] ?? value).join("、");

export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
