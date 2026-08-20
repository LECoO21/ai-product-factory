import { randomUUID } from "node:crypto";
import { PiAgentRuntime } from "@factory/agent-runtime";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";

const workerId = `local-worker-${randomUUID().slice(0, 8)}`;
const projects = new SqliteProjectRegistry();
const runs = new SqliteProductionRunStore();
const runtime = new PiAgentRuntime();
const pollIntervalMs = Number(process.env.WORKER_POLL_MS ?? 1200);
const runOnce = process.env.WORKER_ONCE === "1";
let stopping = false;

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

  let completed = false;
  let failedMessage: string | null = null;
  let missingConfiguration = false;

  for await (const event of runtime.run({
    runId: run.id,
    systemPrompt:
      "你是 AI 产品工厂的接单体检工位。只分析输入 PRD，不修改文件。请用产品语言指出核心任务、重大缺失、风险和推荐下一步。",
    prompt: `生产目标：${run.objective}\n\n产品名称：${project.name}\n\nPRD：\n${project.prd}`,
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    thinkingLevel: "low"
  })) {
    runs.append(run.id, event.type, event.payload);
    if (event.type === "agent.completed") completed = true;
    if (event.type === "agent.failed") {
      failedMessage = String(event.payload.message ?? "Agent 执行失败");
      missingConfiguration = event.payload.code === "deepseek_key_missing";
    }
  }

  if (completed) runs.transition(run.id, "succeeded");
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
