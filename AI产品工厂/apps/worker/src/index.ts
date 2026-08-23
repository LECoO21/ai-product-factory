import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PiAgentRuntime } from "@factory/agent-runtime";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import {
  hasConfirmableAgentResult,
  type AgentRuntimeEvent,
  type ProductProject,
  type ProductionRun,
  type ProductionStage
} from "@factory/shared";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const workerId = `local-worker-${randomUUID().slice(0, 8)}`;
const projects = new SqliteProjectRegistry();
const runs = new SqliteProductionRunStore();
const runtime = new PiAgentRuntime();
const pollIntervalMs = Number(process.env.WORKER_POLL_MS ?? 1200);
const runOnce = process.env.WORKER_ONCE === "1";
let stopping = false;

const manualPaths = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
].map((name) => fileURLToPath(new URL(`../../../../${name}`, import.meta.url)));

const manualContext = manualPaths.every(existsSync)
  ? manualPaths.map((path) => readFileSync(path, "utf8")).join("\n\n--- 下一份原始手册 ---\n\n")
  : null;

const stationInstructions: Record<
  Extract<ProductionStage, "intake" | "adaptation" | "stage-design">,
  { systemPrompt: string; outputRequest: string }
> = {
  intake: {
    systemPrompt:
      "你是 AI 产品工厂的接单体检工位。只分析输入 PRD，不修改文件。使用普通产品语言，输出产品理解、核心任务、重大缺失和推荐下一步。",
    outputRequest: "请生成一份供产品负责人确认的简洁产品理解摘要。"
  },
  adaptation: {
    systemPrompt:
      "你是 AI 产品工厂的技术适配工位。严格遵守随任务提供的三份原始手册，根据 PRD 给出唯一推荐方案，不罗列多套技术让产品负责人选择。",
    outputRequest:
      "请按《技术适配声明》的要求，输出产品形态、采用方案、按需模块、偏离项、强制底线和真正需要产品负责人决定的问题。"
  },
  "stage-design": {
    systemPrompt:
      "你是 AI 产品工厂的阶段设计工位。严格遵守随任务提供的三份原始手册，只设计当前第一阶段，输出非技术人员也能照着验收的开发计划。",
    outputRequest:
      "请生成第一阶段开发计划，包含目标、范围、主链路、状态、接口、测试、验收清单、风险和明确不做。"
  }
};

const previousResult = (run: ProductionRun) => {
  const previous = runs
    .listForProject(run.projectId)
    .find((candidate) => candidate.createdAt < run.createdAt && candidate.status === "succeeded");
  if (!previous) return "无";
  return runs
    .events(previous.id)
    .filter((event) => event.type === "text.delta")
    .map((event) => String(event.payload.delta ?? ""))
    .join("");
};

const buildAssignment = (run: ProductionRun, project: ProductProject) => {
  if (!(run.stage in stationInstructions)) return null;
  const instruction = stationInstructions[run.stage as keyof typeof stationInstructions];
  return {
    runId: run.id,
    systemPrompt: instruction.systemPrompt,
    prompt: [
      `生产目标：${run.objective}`,
      `产品名称：${project.name}`,
      `PRD：\n${project.prd}`,
      `上一工位结果：\n${previousResult(run)}`,
      `三份原始手册全文：\n${manualContext ?? "缺失"}`,
      instruction.outputRequest
    ].join("\n\n"),
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    thinkingLevel: "low" as const
  };
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function executeNext() {
  const run = runs.claimNext(workerId);
  if (!run) return false;
  const project = projects.get(run.projectId);
  if (!project) {
    runs.transition(run.id, "failed", "产品项目不存在");
    return true;
  }
  if (!manualContext) {
    runs.transition(run.id, "blocked", "三份原始手册缺失，已停止生产");
    return true;
  }
  const assignment = buildAssignment(run, project);
  if (!assignment) {
    runs.transition(run.id, "blocked", "当前工位尚未接入受控执行工具");
    return true;
  }

  let completed = false;
  let failedMessage: string | null = null;
  let missingConfiguration = false;
  const executionEvents: AgentRuntimeEvent[] = [];

  for await (const event of runtime.run(assignment)) {
    executionEvents.push(event);
    runs.append(run.id, event.type, event.payload);
    if (event.type === "agent.completed") completed = true;
    if (event.type === "agent.failed") {
      failedMessage = String(event.payload.message ?? "Agent 执行失败");
      missingConfiguration = event.payload.code === "deepseek_key_missing";
    }
  }

  if (completed && hasConfirmableAgentResult(executionEvents)) {
    runs.append(run.id, "gate.requested", { gate: "product_scope", stage: run.stage });
    runs.transition(run.id, "waiting_approval");
  } else if (completed) runs.transition(run.id, "failed", "AI 未生成可确认结果，请重新分析");
  else if (missingConfiguration) runs.transition(run.id, "blocked", failedMessage);
  else runs.transition(run.id, "failed", failedMessage ?? "Agent 未正常结束");
  return true;
}

async function main() {
  console.log(`[worker] ${workerId} started; DeepSeek configured: ${runtime.isConfigured()}`);
  do {
    const worked = await executeNext();
    if (runOnce) break;
    if (!worked) await wait(pollIntervalMs);
  } while (!stopping);
  console.log(`[worker] ${workerId} stopped`);
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((error: unknown) => {
  console.error("[worker] fatal", error);
  process.exitCode = 1;
});
