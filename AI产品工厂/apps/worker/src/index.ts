import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildFactoryHarnessSystemPrompt,
  createProductionPiHarnessDriver,
  PiAgentRuntime
} from "@factory/agent-runtime";
import {
  BackgroundRunner,
  CompletionVerifier,
  ControlledCommandRunner,
  createBackgroundToolDefinition,
  createCoreToolDefinitions,
  FactoryHarness,
  LocalWorkspace,
  ManualAuthority,
  ToolGateway
} from "@factory/harness";
import {
  defaultDatabasePath,
  findFactoryRoot,
  SqliteHarnessRecordStore,
  SqliteProductionRunStore,
  SqliteProjectRegistry
} from "@factory/records";
import {
  FactoryRuntimeCore,
  type RuntimeTurnContext,
  type RuntimeTurnHandler,
  type TurnOutcome
} from "@factory/runtime-core";
import {
  hasConfirmableAgentResult,
  type AgentRuntimeEvent,
  type ProductProject,
  type ProductionRun,
  type ProductionStage
} from "@factory/shared";
import { formatProductQualityReport, runProductQuality } from "./product-quality";
import { getProductOutputArtifact, isHarnessValidationObjective } from "./product-output";
import { buildReleaseHandoff, evaluateReleaseReadiness } from "./release-flow";

const fallbackProjectRoot = findFactoryRoot(process.cwd());
const projectRoot = process.env.FACTORY_PROJECT_ROOT?.trim() || fallbackProjectRoot;
const envFile = join(projectRoot, ".env");
if (process.env.ENV?.trim() !== "prod" && existsSync(envFile)) process.loadEnvFile(envFile);

const workerId = `local-worker-${randomUUID().slice(0, 8)}`;
const projects = new SqliteProjectRegistry();
const runs = new SqliteProductionRunStore();
const harnessRecords = new SqliteHarnessRecordStore();
const runtime = new PiAgentRuntime();
const pollIntervalMs = Number(process.env.WORKER_POLL_MS ?? 1200);
const runOnce = process.env.WORKER_ONCE === "1";
let stopping = false;

const dataRoot = dirname(defaultDatabasePath());
const authority = new ManualAuthority(projectRoot);
let manualContext: string | null = null;
let manualError: string | null = null;
try {
  manualContext = authority.load("v0.2-b").context;
} catch (error) {
  manualError = error instanceof Error ? error.message : "三份原始手册校验失败";
}

const stationInstructions: Record<
  Extract<
    ProductionStage,
    "intake" | "adaptation" | "stage-design" | "implementation" | "release-preparation"
  >,
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
      "你是 AI 产品工厂的阶段设计工位。严格遵守随任务提供的三份原始手册，只设计当前第一阶段，输出非技术人员也能照着验收的开发计划，并同时制作当前产品自己的可交互基础 HTML。基础 HTML 是产品方向原型，不得做成产品工厂流程说明页。",
    outputRequest:
      "请生成第一阶段开发计划，包含目标、范围、主链路、状态、接口、测试、验收清单、风险和明确不做。文档末尾必须依次输出 <!-- PRODUCT_PROTOTYPE_START -->、完整且无需外部依赖的单文件 HTML、<!-- PRODUCT_PROTOTYPE_END -->。HTML 必须体现当前产品的核心输入、操作、成功、失败和空状态，可直接点击验收；清楚标注为基础稿，不得调用真实付费服务或伪造真实数据。"
  },
  implementation: {
    systemPrompt:
      "你是 AI 产品工厂的制作产品工位。严格遵守随任务提供的三份原始手册、已确认开发计划和产品基础稿，制作当前第一阶段的可运行产品。只制作当前产品，不得输出产品工厂自己的流程演示。",
    outputRequest:
      "请先简洁说明本次制作完成的功能、用户可见状态、限制和验收方法。文档末尾必须依次输出 <!-- PRODUCT_PROTOTYPE_START -->、完整且无需外部依赖的单文件 HTML、<!-- PRODUCT_PROTOTYPE_END -->。HTML 必须是当前产品的第一版可运行结果，覆盖核心输入、操作、加载、成功、失败和空状态；不得外连资源、不得泄露密钥、不得把示例数据冒充真实服务。"
  },
  "release-preparation": {
    systemPrompt:
      "你是 AI 产品工厂的上线方案工位。严格遵守三份原始手册，只生成当前产品的上线方案，不执行 Git push、建仓库、登录平台、购买资源、配置正式凭证或部署。",
    outputRequest:
      "请生成简洁上线方案，包含候选版本、目标环境、必要配置键名、自动检查与人工验收证据、发布前确认项、人工发布步骤、回滚方案和明确未执行事项。不得输出任何真实密钥值。"
  }
};

const releaseHistory = (projectId: string) =>
  runs.listForProject(projectId).map((historyRun) => ({
    run: historyRun,
    events: runs.events(historyRun.id)
  }));

function executeReleaseReadiness({ run, events }: RuntimeTurnContext): TurnOutcome {
  const result = evaluateReleaseReadiness(releaseHistory(run.projectId));
  events.legacy("text.delta", { delta: result.markdown });
  events.legacy("release.readiness.completed", {
    passed: result.passed,
    checks: result.checks
  });
  events.legacy("agent.completed", { deterministic: true, checkCount: result.checks.length });
  if (!result.passed) {
    return { kind: "failed", message: "上线材料检查未通过" };
  }
  return {
    kind: "awaiting_approval",
    approvalId: `approval:${run.id}:release_readiness`,
    gate: "release_readiness"
  };
}

function executeReleaseHandoff({ run, project, events }: RuntimeTurnContext): TurnOutcome {
  try {
    const handoff = buildReleaseHandoff(releaseHistory(run.projectId), project.name);
    events.legacy("text.delta", { delta: handoff });
    events.legacy("artifact.created", {
      kind: "manual-release-checklist",
      title: `${project.name}｜手工发布清单`,
      mediaType: "text/markdown",
      content: handoff
    });
    events.legacy("release.handoff.completed", {
      deploymentStarted: false,
      targetStatus: "candidate"
    });
    events.legacy("agent.completed", { deterministic: true });
    return {
      kind: "awaiting_approval",
      approvalId: `approval:${run.id}:release_handoff`,
      gate: "release_handoff"
    };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : "无法生成发布交接清单"
    };
  }
}

const previousResult = (run: ProductionRun) => {
  const history = runs.listForProject(run.projectId).filter((candidate) => candidate.id !== run.id);
  const revisionSource = history.find((candidate) =>
    runs.events(candidate.id).some(
      (event) =>
        event.type === "gate.revision_requested" && event.payload.revisionRunId === run.id
    )
  );
  const previous = revisionSource ?? history.find((candidate) => candidate.status === "succeeded");
  if (!previous) return "无";
  const output = runs
    .events(previous.id)
    .filter((event) => event.type === "text.delta")
    .map((event) => String(event.payload.delta ?? ""))
    .join("");
  if (!revisionSource || revisionSource.stage === run.stage) return output;

  const previousSameStage = history.find(
    (candidate) =>
      candidate.id !== revisionSource.id &&
      candidate.stage === run.stage &&
      hasConfirmableAgentResult(runs.events(candidate.id))
  );
  if (!previousSameStage) return output;
  const sameStageOutput = runs
    .events(previousSameStage.id)
    .filter((event) => event.type === "text.delta")
    .map((event) => String(event.payload.delta ?? ""))
    .join("");
  return `需要处理的确认结果：\n${output}\n\n上一版同工位完整结果：\n${sameStageOutput}`;
};

const previousImplementationArtifact = (run: ProductionRun) => {
  const implementation = runs
    .listForProject(run.projectId)
    .find(
      (candidate) =>
        candidate.createdAt < run.createdAt &&
        candidate.stage === "implementation" &&
        candidate.status === "succeeded"
    );
  if (!implementation) return null;
  const artifact = [...runs.events(implementation.id)]
    .reverse()
    .find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "product-prototype-html"
    );
  const content = artifact?.payload.content;
  return typeof content === "string" && content.trim()
    ? { run: implementation, content }
    : null;
};

async function executeAutomatedQuality({ run, events }: RuntimeTurnContext): Promise<TurnOutcome> {
  const source = previousImplementationArtifact(run);
  if (!source) {
    return { kind: "failed", message: "找不到已确认的第一版产品 HTML，无法自动检查" };
  }

  events.legacy("quality.started", { sourceRunId: source.run.id });
  try {
    const report = await runProductQuality(source.content, {
      origin: process.env.FACTORY_WEB_ORIGIN?.trim() || "http://localhost:3000"
    });
    events.legacy("text.delta", { delta: formatProductQualityReport(report) });
    events.legacy("quality.completed", {
      passed: report.passed,
      sourceRunId: source.run.id,
      checks: report.checks
    });
    if (!report.passed) {
      return { kind: "failed", message: "自动检查未通过，请查看失败项后重新制作" };
    }
    events.legacy("agent.completed", { deterministic: true, checkCount: report.checks.length });
    return {
      kind: "awaiting_approval",
      approvalId: `approval:${run.id}:automated_quality`,
      gate: "automated_quality"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动检查执行失败";
    events.legacy("quality.failed", { message });
    return { kind: "failed", message };
  }
}

const prepareHarnessWorkspace = (productionRunId: string) => {
  const workspaceRoot = join(dataRoot, "workspaces", productionRunId);
  if (!existsSync(workspaceRoot)) {
    mkdirSync(dirname(workspaceRoot), { recursive: true });
    cpSync(join(projectRoot, "tests", "fixtures", "harness-loop"), workspaceRoot, { recursive: true });
    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: workspaceRoot, stdio: "ignore" });
  }
  return workspaceRoot;
};

async function executeHarnessValidation({ run, events }: RuntimeTurnContext): Promise<TurnOutcome> {
  const existingTask = harnessRecords.getTaskForRun(run.id);
  const task = existingTask ?? harnessRecords.createTask(
    run.id,
    "验证单 Factory Harness 能读取、修改、观察测试失败、修复并复测通过",
    2
  );
  const verifier = new CompletionVerifier(harnessRecords);
  const factoryHarness = new FactoryHarness({
    records: harnessRecords,
    verifier,
    prepare: async (factoryTask, harnessRun) => {
      const loadedManuals = authority.load("v0.2-b");
      const workspaceRoot = prepareHarnessWorkspace(run.id);
      const workspace = new LocalWorkspace(workspaceRoot);
      const commands = new ControlledCommandRunner(workspaceRoot);
      const gateway = new ToolGateway({ records: harnessRecords, workspaceRoot, p1Approved: true });
      const background = new BackgroundRunner(harnessRecords, commands);
      const definitions = createCoreToolDefinitions({
        authority,
        workspace,
        commands,
        records: harnessRecords,
        harnessRunId: harnessRun.id,
        taskId: factoryTask.id,
        reportRoot: join(dataRoot, "reports", harnessRun.id)
      });
      definitions.push(createBackgroundToolDefinition(background, factoryTask.id));
      definitions.forEach((definition) => gateway.register(definition));
      const driver = await createProductionPiHarnessDriver({
        apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
        modelName: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
        dataRoot,
        workspaceRoot,
        runId: harnessRun.id,
        systemPrompt: buildFactoryHarnessSystemPrompt(loadedManuals.context),
        gateway,
        toolNames: definitions.map((definition) => definition.name)
      });
      return {
        driver,
        requiredCriteria: ["CG-06"],
        execute: (call: { toolCallId: string; toolName: string; args: Record<string, unknown> }) =>
          gateway.execute({ harnessRunId: harnessRun.id, ...call }),
        prompt: [
          `Task：${factoryTask.objective}`,
          "你必须在当前 fixture 工作区完成确定性闭环：",
          "1. manual.verify、manual.load；2. 建立 WorkPlan；3. 读取 math.js；",
          "4. 先把 add 改成错误实现并运行 test，真实记录非零 exitCode 和失败 Evidence；",
          "5. 读取失败后把 add 修回正确实现并复测到 exitCode=0；",
          "6. 生成 git diff，登记最终通过 Evidence（criterionId=CG-06）。",
          "不得跳过第一次失败，不得用文字自评代替工具证据。"
        ].join("\n")
      };
    }
  });
  let lastControlSequence = 0;
  let checkingControls = false;
  const controlTimer = setInterval(() => {
    if (checkingControls) return;
    checkingControls = true;
    void (async () => {
      const harnessRun = harnessRecords.getHarnessRunForProductionRun(run.id);
      if (!harnessRun) return;
      const commands = runs.events(run.id, lastControlSequence)
        .filter((event) => event.type === "harness.command.steer" || event.type === "harness.command.abort");
      for (const command of commands) {
        lastControlSequence = Math.max(lastControlSequence, command.sequence);
        const receipt = command.type === "harness.command.abort"
          ? await factoryHarness.abort(harnessRun.id, String(command.payload.reason ?? "用户停止"))
          : await factoryHarness.steer(harnessRun.id, String(command.payload.message ?? ""));
        events.legacy("harness.command.receipt", {
          commandSequence: command.sequence,
          commandType: command.type,
          ...receipt
        });
      }
    })().finally(() => { checkingControls = false; });
  }, 500);
  const snapshot = await factoryHarness.run(task.id).finally(() => clearInterval(controlTimer));
  events.legacy("harness.snapshot", {
    harnessRunId: snapshot.id,
    status: snapshot.status,
    stopReason: snapshot.stopReason,
    plan: snapshot.plan,
    artifacts: snapshot.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind, sha256: artifact.sha256, size: artifact.size
    })),
    evidence: snapshot.evidence
  });
  for (const invocation of harnessRecords.listInvocations(snapshot.id)) {
    events.legacy("harness.tool", {
      toolCallId: invocation.toolCallId,
      toolName: invocation.toolName,
      permission: invocation.permission,
      status: invocation.status,
      summary: invocation.result?.summary ?? null
    });
  }
  if (snapshot.status === "succeeded") {
    events.legacy("text.delta", {
      delta: "最小 Harness 已真实完成：读取文件 → 修改 → 测试失败 → 修复 → 复测通过，并已登记产物与证据。"
    });
    events.legacy("harness.completed", { harnessRunId: snapshot.id, completionGoal: "CG-06" });
    events.legacy("agent.completed", { deterministicVerifier: true });
    return {
      kind: "awaiting_approval",
      approvalId: `approval:${run.id}:g6_harness_acceptance`,
      gate: "g6_harness_acceptance"
    };
  } else if (snapshot.status === "blocked") {
    return { kind: "blocked", message: snapshot.stopReason ?? "Harness 被阻塞" };
  } else if (snapshot.status === "cancelled") {
    return { kind: "interrupted", message: snapshot.stopReason ?? "Harness 已停止" };
  }
  return { kind: "failed", message: snapshot.stopReason ?? "Harness 未通过确定性完成验证" };
}

function prepareRealAcceptance({ run, project, events }: RuntimeTurnContext): TurnOutcome {
  const source = previousImplementationArtifact(run);
  if (!source) {
    return { kind: "failed", message: "找不到已确认的第一版产品，无法开始真实验收" };
  }
  events.legacy("artifact.created", {
    kind: "product-prototype-html",
    title: `${project.name}｜真实验收版本`,
    mediaType: "text/html",
    href: `/api/runs/${source.run.id}/prototype`,
    content: source.content
  });
  events.legacy("text.delta", {
    delta: [
      "# 真实产品验收",
      "",
      "请点击“打开产品验收”，亲自完成一次核心操作。",
      "",
      "- 检查输入是否容易理解",
      "- 检查加载、成功和失败反馈是否清楚",
      "- 检查结果是否符合真实使用预期",
      "- 确认通过后，系统只生成发布准备方案，不会自动部署"
    ].join("\n")
  });
  events.legacy("agent.completed", { deterministic: true, sourceRunId: source.run.id });
  return {
    kind: "awaiting_approval",
    approvalId: `approval:${run.id}:real_acceptance`,
    gate: "real_acceptance"
  };
}

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

async function executeAgentStation({
  run,
  project,
  events
}: RuntimeTurnContext): Promise<TurnOutcome> {
  const assignment = buildAssignment(run, project);
  if (!assignment) return { kind: "blocked", message: "当前工位尚未接入受控执行工具" };

  let completed = false;
  let failedMessage: string | null = null;
  let missingConfiguration = false;
  const executionEvents: AgentRuntimeEvent[] = [];

  for await (const event of runtime.run(assignment)) {
    executionEvents.push(event);
    events.legacy(event.type, event.payload);
    if (event.type === "agent.completed") completed = true;
    if (event.type === "agent.failed") {
      failedMessage = String(event.payload.message ?? "Agent 执行失败");
      missingConfiguration = event.payload.code === "deepseek_key_missing";
    }
  }

  if (completed && hasConfirmableAgentResult(executionEvents)) {
    if (run.stage === "stage-design" || run.stage === "implementation") {
      const output = executionEvents
        .filter((event) => event.type === "text.delta")
        .map((event) => String(event.payload.delta ?? ""))
        .join("");
      let artifact;
      try {
        artifact = getProductOutputArtifact(run.stage, output, project.name);
      } catch (error) {
        return {
          kind: "failed",
          message: error instanceof Error ? error.message : "产品 HTML 生成失败"
        };
      }
      if (!artifact) return { kind: "failed", message: "产品 HTML 生成失败" };
      events.legacy("artifact.created", {
        ...artifact,
        href: `/api/runs/${run.id}/prototype`
      });
    }
    return {
      kind: "awaiting_approval",
      approvalId: `approval:${run.id}:product_scope`,
      gate: "product_scope"
    };
  }
  if (completed) return { kind: "failed", message: "AI 未生成可确认结果，请重新分析" };
  if (missingConfiguration) {
    return { kind: "blocked", message: failedMessage ?? "尚未配置 DeepSeek" };
  }
  return { kind: "failed", message: failedMessage ?? "Agent 未正常结束" };
}

const runtimeHandlers: RuntimeTurnHandler[] = [
  {
    id: "manual-authority",
    supports: () => manualContext === null,
    execute: async () => ({
      kind: "blocked",
      message: manualError ?? "三份原始手册缺失，已停止生产"
    })
  },
  {
    id: "harness-validation",
    supports: (run) => run.stage === "implementation" && isHarnessValidationObjective(run.objective),
    execute: executeHarnessValidation
  },
  {
    id: "automated-quality",
    supports: (run) => run.stage === "automated-quality",
    execute: executeAutomatedQuality
  },
  {
    id: "real-acceptance",
    supports: (run) => run.stage === "real-acceptance",
    execute: async (context) => prepareRealAcceptance(context)
  },
  {
    id: "release-readiness",
    supports: (run) => run.stage === "release-readiness",
    execute: async (context) => executeReleaseReadiness(context)
  },
  {
    id: "release-handoff",
    supports: (run) => run.stage === "release-handoff",
    execute: async (context) => executeReleaseHandoff(context)
  },
  {
    id: "pi-agent-station",
    supports: (run, project) => buildAssignment(run, project) !== null,
    execute: executeAgentStation
  }
];

const runtimeCore = new FactoryRuntimeCore(runs, runtimeHandlers);

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
  await runtimeCore.execute(run, project);
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

let workerPromise: Promise<void> | null = null;

export function startFactoryWorker() {
  if (workerPromise) return workerPromise;
  stopping = false;
  workerPromise = main().finally(() => {
    workerPromise = null;
  });
  return workerPromise;
}

export function stopFactoryWorker() {
  stopping = true;
}

const executedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (executedDirectly) {
  process.on("SIGINT", stopFactoryWorker);
  process.on("SIGTERM", stopFactoryWorker);
  startFactoryWorker().catch((error: unknown) => {
    console.error("[worker] fatal", error);
    process.exitCode = 1;
  });
}
