import type {
  CapabilityPack,
  ProductProject,
  ProductionRun,
  ProductionStage
} from "@factory/shared";

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
  ready: "等待开始",
  running: "AI 正在处理",
  waiting_approval: "等你确认",
  blocked: "等待配置",
  succeeded: "这一步已完成",
  failed: "这一步失败",
  cancelled: "已取消"
};

const waitingApprovalLabels: Partial<Record<ProductionStage, string>> = {
  intake: "产品理解待确认",
  adaptation: "技术方案待确认",
  "stage-design": "开发计划待确认",
  implementation: "制作结果待确认",
  "automated-quality": "自动检查待确认",
  "real-acceptance": "验收结果待确认",
  "release-preparation": "上线方案待确认",
  "release-readiness": "上线检查待确认",
  "release-handoff": "发布交接待确认"
};

export const getRunStatusLabel = (run: Pick<ProductionRun, "stage" | "status">) =>
  run.status === "waiting_approval"
    ? waitingApprovalLabels[run.stage] ?? runStatusLabels[run.status]
    : runStatusLabels[run.status];

export const stageLabels: Record<ProductionStage, string> = {
  intake: "理解产品",
  adaptation: "确定技术方案",
  "stage-design": "生成开发计划",
  implementation: "制作产品",
  "automated-quality": "自动检查",
  "real-acceptance": "测试验收",
  "release-preparation": "生成上线方案",
  "release-readiness": "检查上线材料",
  "release-handoff": "待人工发布"
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
