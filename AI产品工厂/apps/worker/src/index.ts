import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildFactoryHarnessSystemPrompt,
  CodexAccountService,
  CodexAppServerClient,
  CodexAppServerRuntime,
  createProductionCodexHarnessDriver
} from "@factory/agent-runtime";
import {
  BackgroundRunner,
  CompletionVerifier,
  ControlledCommandRunner,
  createBackgroundToolDefinition,
  createCoreToolDefinitions,
  FactoryHarness,
  LocalWorkspace,
  ProductManualAuthorityRegistry,
  ToolGateway
} from "@factory/harness";
import {
  defaultDatabasePath,
  findFactoryRoot,
  SqliteCodexRuntimeStore,
  SqliteHarnessRecordStore,
  SqliteProductManualIssuanceStore,
  SqliteProductManualSnapshotStore,
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
import {
  markCodexAccountUnavailable,
  processNextCodexAccountCommand,
  refreshCodexAccountSnapshot,
  shutdownCodexRuntime,
  startCodexAccountHeartbeat,
  refreshCodexRuntimeSnapshots
} from "./codex-control";
import {
  mediaCapabilityContext,
  unavailableMediaStations,
  verifyRequiredMediaArtifacts,
  type VerifiedMediaArtifact
} from "./media-production";
import { shouldCloseProductManualSnapshot } from "./manual-lifecycle";
import { startRunControlBridge as createRunControlBridge } from "./run-control";

const fallbackProjectRoot = findFactoryRoot(process.cwd());
const projectRoot = process.env.FACTORY_PROJECT_ROOT?.trim() || fallbackProjectRoot;
const envFile = join(projectRoot, ".env");
if (process.env.ENV?.trim() !== "prod" && existsSync(envFile)) process.loadEnvFile(envFile);

const workerId = `local-worker-${randomUUID().slice(0, 8)}`;
const projects = new SqliteProjectRegistry();
const runs = new SqliteProductionRunStore();
const harnessRecords = new SqliteHarnessRecordStore();
const codexRecords = new SqliteCodexRuntimeStore();
const manualIssuanceStore = new SqliteProductManualIssuanceStore();
const manualSnapshotStore = new SqliteProductManualSnapshotStore();
const codexClient = new CodexAppServerClient();
const codexAccount = new CodexAccountService(codexClient);
const runtime = new CodexAppServerRuntime({
  client: codexClient,
  bindings: codexRecords,
  defaultCwd: projectRoot
});
const pollIntervalMs = Number(process.env.WORKER_POLL_MS ?? 1200);
const runOnce = process.env.WORKER_ONCE === "1";
const shutdownGraceMs = Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 5_000);
let stopping = false;
let activeRunId: string | null = null;
let activeRunFinished: Promise<void> = Promise.resolve();
let finishActiveRun: (() => void) | null = null;
let codexClosePromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;

const dataRoot = dirname(defaultDatabasePath());
// Each product flow owns one immutable, uncompressed manual snapshot. Stages,
// revisions and retries reuse it; a completed flow is released and closed.
const manualAuthorities = new ProductManualAuthorityRegistry(
  projectRoot,
  manualSnapshotStore,
  manualIssuanceStore
);
const manualFailures = new Map<string, string>();

const releaseTerminalManualSnapshots = () => {
  for (const productFlowId of manualAuthorities.activeFlowIds()) {
    const project = projects.get(productFlowId);
    const histories = runs.listForProject(productFlowId).map((run) => ({
      events: runs.events(run.id)
    }));
    if (shouldCloseProductManualSnapshot(project, histories)) {
      manualAuthorities.release(productFlowId);
    }
  }
};

const logCodexFailure = (event: string, error: unknown, detail: Record<string, unknown> = {}) => {
  console.error(JSON.stringify({
    level: "error",
    event,
    ...detail,
    errorType: error instanceof Error ? error.name : "unknown"
  }));
};

let snapshotRefreshTail = Promise.resolve();
const scheduleAccountSnapshotRefresh = (refreshToken = false) => {
  snapshotRefreshTail = snapshotRefreshTail
    .then(() => refreshCodexAccountSnapshot(codexAccount, codexRecords, refreshToken))
    .then(() => undefined)
    .catch((error: unknown) => {
      logCodexFailure("codex_runtime.account_snapshot_refresh_failed", error);
    });
  return snapshotRefreshTail;
};

const scheduleRuntimeSnapshotRefresh = (refreshToken = false) => {
  snapshotRefreshTail = snapshotRefreshTail
    .then(() => refreshCodexRuntimeSnapshots({
      account: codexAccount,
      store: codexRecords,
      cwd: projectRoot,
      refreshToken
    }))
    .then(() => undefined)
    .catch((error: unknown) => {
      logCodexFailure("codex_runtime.snapshot_refresh_failed", error);
    });
  return snapshotRefreshTail;
};

const closeCodexClient = () => {
  codexClosePromise ??= codexClient.close();
  return codexClosePromise;
};

const markRunActive = (runId: string) => {
  activeRunId = runId;
  activeRunFinished = new Promise<void>((resolve) => {
    finishActiveRun = resolve;
  });
};

const markRunFinished = (runId: string) => {
  if (activeRunId !== runId) return;
  activeRunId = null;
  finishActiveRun?.();
  finishActiveRun = null;
};

const stationInstructions: Record<
  Extract<
    ProductionStage,
    "intake" | "adaptation" | "stage-design" | "implementation" | "release-preparation"
  >,
  { systemPrompt: string; outputRequest: string }
> = {
  intake: {
    systemPrompt:
      "你负责分析产品需求。只分析输入 PRD，不修改文件。使用普通产品语言，输出对需求的理解、核心任务、重大缺失和推荐下一步。",
    outputRequest: "请生成一份供产品负责人确认的简洁需求分析，文档标题使用“需求分析”。"
  },
  adaptation: {
    systemPrompt:
      "你负责制定产品的技术方案。严格遵守随任务提供的三份原始手册，根据 PRD 给出唯一推荐方案，不罗列多套技术让产品负责人选择。",
    outputRequest:
      "请按《技术适配声明》的要求，输出产品形态、采用方案、按需模块、偏离项、强制底线和真正需要产品负责人决定的问题，文档标题使用“技术方案”。"
  },
  "stage-design": {
    systemPrompt:
      "你负责制定当前阶段的开发计划。严格遵守随任务提供的三份原始手册，只设计当前第一阶段，输出非技术人员也能照着验收的开发计划，并同时制作当前产品自己的可交互基础 HTML。基础 HTML 是产品方向原型，不得做成产品工厂流程说明页。",
    outputRequest:
      "请生成第一阶段开发计划，文档标题使用“开发计划”，包含目标、范围、主链路、状态、接口、测试、验收清单、风险和明确不做。文档末尾必须依次输出 <!-- PRODUCT_PROTOTYPE_START -->、完整且无需外部依赖的单文件 HTML、<!-- PRODUCT_PROTOTYPE_END -->。HTML 必须体现当前产品的核心输入、操作、成功、失败和空状态，可直接点击验收；清楚标注为基础稿，不得调用真实付费服务或伪造真实数据。"
  },
  implementation: {
    systemPrompt:
      "你负责实现当前阶段的产品功能。严格遵守随任务提供的三份原始手册、已确认开发计划和产品基础稿，制作当前第一阶段的可运行产品。只制作当前产品，不得输出产品工厂自己的流程演示。",
    outputRequest:
      "文档标题使用“产品实现结果”，先简洁说明本次制作完成的功能、用户可见状态、限制和验收方法。文档末尾必须依次输出 <!-- PRODUCT_PROTOTYPE_START -->、完整且无需外部依赖的单文件 HTML、<!-- PRODUCT_PROTOTYPE_END -->。HTML 必须是当前产品的第一版可运行结果，覆盖核心输入、操作、加载、成功、失败和空状态；不得外连资源、不得泄露密钥、不得把示例数据冒充真实服务。"
  },
  "release-preparation": {
    systemPrompt:
      "你负责制定产品的上线方案。严格遵守三份原始手册，只生成当前产品的上线方案，不执行 Git push、建仓库、登录平台、购买资源、配置正式凭证或部署。",
    outputRequest:
      "请生成简洁上线方案，文档标题使用“上线方案”，包含候选版本、目标环境、必要配置键名、自动检查与人工验收证据、发布前确认项、人工发布步骤、回滚方案和明确未执行事项。不得输出任何真实密钥值。"
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
    .join("") || previous.error || "上一阶段没有生成文本结果，请检查失败证据";
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
  return `需要处理的确认结果：\n${output}\n\n上一版同阶段完整结果：\n${sameStageOutput}`;
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
    const message = "找不到已确认的第一版产品 HTML，无法自动检查";
    events.legacy("quality.failed", { message });
    return { kind: "failed", message };
  }

  events.legacy("quality.started", { sourceRunId: source.run.id });
  try {
    const report = await runProductQuality(source.content);
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

const startRunControlBridge = (
  run: ProductionRun,
  events: RuntimeTurnContext["events"],
  dispatch: Parameters<typeof createRunControlBridge>[0]["dispatch"]
) => createRunControlBridge({
  read: (cursor) => runs.events(run.id, cursor),
  receipt: (payload) => events.legacy("harness.command.receipt", payload),
  dispatch
});

async function executeHarnessValidation({
  run,
  project,
  events
}: RuntimeTurnContext): Promise<TurnOutcome> {
  const manuals = manualAuthorities.acquire(project.id);
  const existingTask = harnessRecords.getTaskForRun(run.id);
  const task = existingTask ?? harnessRecords.createTask(
    run.id,
    "验证单 Factory Harness 能读取、修改、观察测试失败、修复并复测通过",
    2
  );
  const verifier = new CompletionVerifier(harnessRecords);
  const g6HarnessApproved = runs.listForProject(project.id).some(
    (candidate) =>
      candidate.id !== run.id &&
      isHarnessValidationObjective(candidate.objective) &&
      candidate.status === "succeeded"
  );
  const p1Approved = isHarnessValidationObjective(run.objective) || g6HarnessApproved;
  const completionCriteria = ["CG-06"];
  const factoryHarness = new FactoryHarness({
    records: harnessRecords,
    verifier,
    prepare: async (factoryTask, harnessRun) => {
      const workspaceRoot = prepareHarnessWorkspace(run.id);
      const workspace = new LocalWorkspace(workspaceRoot);
      const commands = new ControlledCommandRunner(workspaceRoot);
      const gateway = new ToolGateway({ records: harnessRecords, workspaceRoot, p1Approved });
      const background = new BackgroundRunner(harnessRecords, commands);
      const definitions = createCoreToolDefinitions({
        authority: manuals.authority,
        workspace,
        commands,
        records: harnessRecords,
        harnessRunId: harnessRun.id,
        taskId: factoryTask.id,
        reportRoot: join(dataRoot, "reports", harnessRun.id),
        completionCriteria
      });
      definitions.push(createBackgroundToolDefinition(background, factoryTask.id));
      definitions.forEach((definition) => gateway.register(definition));
      const driver = createProductionCodexHarnessDriver({
        runtime,
        workspaceRoot,
        runId: harnessRun.id,
        systemPrompt: buildFactoryHarnessSystemPrompt(manuals.snapshot.context),
        gateway,
        definitions
      });
      return {
        driver,
        requiredCriteria: completionCriteria,
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
  const stopControls = startRunControlBridge(run, events, async (type, value) => {
    const harnessRun = harnessRecords.getHarnessRunForProductionRun(run.id);
    if (!harnessRun) {
      return { accepted: false, message: "Harness 尚未开始", retryWhenInactive: true };
    }
    const receipt = type === "harness.command.abort"
      ? await factoryHarness.abort(harnessRun.id, value)
      : await factoryHarness.steer(harnessRun.id, value);
    return {
      accepted: receipt.accepted,
      message: receipt.message,
      retryWhenInactive: !receipt.accepted && /当前没有可/.test(receipt.message)
    };
  });
  const shouldResume = harnessRecords.getHarnessRunForProductionRun(run.id)?.status === "waiting_user";
  const snapshot = shouldResume
    ? await factoryHarness.resume(task.id).finally(stopControls)
    : await factoryHarness.run(task.id).finally(stopControls);
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
  } else if (snapshot.status === "waiting_user") {
    const pendingCount = harnessRecords.listPendingApprovals(snapshot.id).length;
    events.legacy("text.delta", {
      delta: pendingCount > 0
        ? `当前生产有 ${pendingCount} 个重大动作等待你批准，请查看待审批项并作出决定。`
        : "当前生产有待审批的重大动作，请查看待审批项并作出决定。"
    });
    events.legacy("agent.completed", { deterministic: true, awaitingActionApproval: true });
    return {
      kind: "awaiting_approval",
      approvalId: `approval:${run.id}:harness_action_approval`,
      gate: "harness_action_approval"
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

const buildAssignment = (
  run: ProductionRun,
  project: ProductProject,
  manualContext: string
) => {
  if (!(run.stage in stationInstructions)) return null;
  const instruction = stationInstructions[run.stage as keyof typeof stationInstructions];
  return {
    runId: run.id,
    systemPrompt: instruction.systemPrompt,
    prompt: [
      `本次任务：${run.objective}`,
      `产品名称：${project.name}`,
      `PRD：\n${project.prd}`,
      `上一阶段结果：\n${previousResult(run)}`,
      `三份原始手册全文：\n${manualContext}`,
      `素材生产能力：\n${mediaCapabilityContext(
        project,
        codexRecords.getCapabilitySnapshot()?.capabilities ?? []
      )}`,
      "素材规则：预检的“可尝试”不等于生产成功。需要图片时必须真实调用 imagegen，并让 App Server 返回带有可验证 savedPath 的 imageGeneration 完成事件；图片、音频、3D 均不得用文字声明、占位文件或环境变量伪造成功。",
      "表达要求：用简短、准确的日常语言描述任务和结果，文档标题使用本次明确指定的名称。系统流程标题不使用“接单”“体检”“工位”等比喻；产品业务本身需要的专业术语照常使用。",
      instruction.outputRequest
    ].join("\n\n"),
    model: process.env.CODEX_MODEL?.trim() || "account-default",
    thinkingLevel: "low" as const,
    scopeId: project.id,
    cwd: project.workspacePath?.trim() || projectRoot
  };
};

async function executeAgentStation({
  run,
  project,
  events
}: RuntimeTurnContext): Promise<TurnOutcome> {
  const manuals = manualAuthorities.acquire(project.id);
  const assignment = buildAssignment(run, project, manuals.snapshot.context);
  if (!assignment) return { kind: "blocked", message: "当前阶段尚未接入受控执行工具" };
  if (run.stage === "implementation") {
    const unavailable = unavailableMediaStations(
      project,
      codexRecords.getCapabilitySnapshot()?.capabilities ?? []
    );
    if (unavailable.length > 0) {
      return {
        kind: "blocked",
        message: `${unavailable.map((station) => station.title).join("、")}尚未配置真实 Codex 素材工具`
      };
    }
  }

  let completed = false;
  let failedMessage: string | null = null;
  let authenticationRequired = false;
  let interrupted = false;
  const executionEvents: AgentRuntimeEvent[] = [];

  const stopControls = startRunControlBridge(run, events, async (type, value) => {
    const receipt = type === "harness.command.abort"
      ? await runtime.abort(run.id, value)
      : await runtime.steer(run.id, value);
    return {
      accepted: receipt.accepted,
      message: receipt.reason ?? (receipt.accepted ? "指令已送达 Codex" : "Codex 调用尚未开始"),
      retryWhenInactive: receipt.retryWhenInactive === true
    };
  });
  try {
    for await (const event of runtime.run(assignment)) {
      executionEvents.push(event);
      events.legacy(event.type, event.payload);
      if (event.type === "agent.completed") completed = true;
      if (event.type === "agent.interrupted") interrupted = true;
      if (event.type === "agent.failed") {
        failedMessage = String(event.payload.message ?? "Agent 执行失败");
        authenticationRequired = event.payload.code === "openai_auth_required";
      }
    }
  } finally {
    await stopControls();
  }

  let verifiedMediaArtifacts: VerifiedMediaArtifact[] = [];
  if (completed && run.stage === "implementation") {
    const verification = verifyRequiredMediaArtifacts(project, executionEvents);
    if (!verification.ok) return { kind: "failed", message: verification.message };
    verifiedMediaArtifacts = verification.artifacts;
  }

  if (completed && hasConfirmableAgentResult(executionEvents)) {
    for (const artifact of verifiedMediaArtifacts) {
      events.legacy("artifact.available", {
        kind: "image-asset",
        mediaKind: artifact.kind,
        itemId: artifact.itemId,
        savedPath: artifact.savedPath,
        byteSize: artifact.byteSize,
        sha256: artifact.sha256,
        verified: true,
        verification: "app-server-imageGeneration+filesystem-signature"
      });
    }
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
  if (interrupted) return { kind: "interrupted", message: "Codex Turn 已停止" };
  if (authenticationRequired) {
    return { kind: "blocked", message: failedMessage ?? "请先登录自己的 OpenAI 账户" };
  }
  return { kind: "failed", message: failedMessage ?? "Agent 未正常结束" };
}

const runtimeHandlers: RuntimeTurnHandler[] = [
  {
    id: "manual-authority",
    supports: (run) => manualFailures.has(run.id),
    execute: async ({ run }) => ({
      kind: "blocked",
      message: manualFailures.get(run.id) ?? "三份原始手册缺失，已停止生产"
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
    id: "codex-app-server-station",
    supports: (run) => run.stage in stationInstructions,
    execute: executeAgentStation
  }
];

const runtimeCore = new FactoryRuntimeCore(runs, runtimeHandlers);

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function executeNext() {
  releaseTerminalManualSnapshots();
  const run = runs.claimNext(workerId);
  if (!run) return false;
  markRunActive(run.id);
  try {
    const project = projects.get(run.projectId);
    if (!project) {
      runs.transition(run.id, "failed", "产品项目不存在");
      return true;
    }
    if (shouldCloseProductManualSnapshot(project, runs.listForProject(project.id).map((historyRun) => ({
      events: runs.events(historyRun.id)
    })))) {
      manualAuthorities.release(project.id);
      manualFailures.set(run.id, "产品流程已经完成，禁止重新读取三份原始手册");
    } else {
      try {
        manualAuthorities.acquire(project.id);
      } catch (error) {
        manualFailures.set(
          run.id,
          error instanceof Error ? error.message : "三份原始手册校验失败"
        );
      }
    }
    await runtimeCore.execute(run, project);
    return true;
  } finally {
    manualFailures.delete(run.id);
    releaseTerminalManualSnapshots();
    markRunFinished(run.id);
  }
}

const processNextAccountCommand = () => processNextCodexAccountCommand({
  workerId,
  account: codexAccount,
  store: codexRecords,
  cwd: projectRoot,
  onError: (command, error) => {
    logCodexFailure("codex_runtime.account_command_failed", error, {
      commandId: command.id,
      commandType: command.type
    });
  }
});

async function runAccountCommandLoop() {
  while (!stopping) {
    let worked = false;
    try {
      worked = await processNextAccountCommand();
    } catch (error) {
      logCodexFailure("codex_runtime.account_queue_failed", error);
    }
    if (!worked) await wait(Math.min(pollIntervalMs, 500));
  }
}

async function main() {
  let accountLoop: Promise<void> | null = null;
  const removeCodexNotificationListener = codexClient.onNotification((notification) => {
    if (
      notification.method === "account/login/completed" ||
      notification.method === "account/updated"
    ) {
      scheduleAccountSnapshotRefresh(false);
    } else if (notification.method === "skills/changed") {
      scheduleRuntimeSnapshotRefresh(false);
    }
  });
  const removeCodexConnectionListener = codexClient.onConnectionClosed(() => {
    try {
      markCodexAccountUnavailable(codexRecords);
    } catch (error) {
      logCodexFailure("codex_runtime.account_snapshot_fail_closed_failed", error);
    }
  });
  const stopAccountHeartbeat = startCodexAccountHeartbeat(
    () => scheduleAccountSnapshotRefresh(false),
    15_000
  );
  try {
    const recoveredRuns = runs.recoverRunningRuns(workerId);
    const recoveredCommands = codexRecords.failRunningCommandsForRecovery(
      "上次 Worker 异常退出，账户操作结果未知，请重试"
    );
    const recoveredTasks = harnessRecords.recoverExpiredTasks();
    if (recoveredRuns.length > 0 || recoveredCommands.length > 0 || recoveredTasks.length > 0) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "worker.recovery.completed",
        recoveredRuns: recoveredRuns.length,
        recoveredAccountCommands: recoveredCommands.length,
        recoveredHarnessTasks: recoveredTasks.length
      }));
    }
    try {
      await codexClient.start();
      await scheduleRuntimeSnapshotRefresh(false);
    } catch (error) {
      markCodexAccountUnavailable(codexRecords);
      logCodexFailure("codex_runtime.start_failed", error);
    }
    console.log(`[worker] ${workerId} started; Codex App Server ready: ${codexClient.isReady()}`);
    if (stopping) return;
    if (runOnce) {
      const handledAccountCommand = await processNextAccountCommand();
      if (!handledAccountCommand) await executeNext();
      return;
    }
    accountLoop = runAccountCommandLoop();
    while (!stopping) {
      const worked = await executeNext();
      if (!worked) await wait(pollIntervalMs);
    }
  } finally {
    stopping = true;
    stopAccountHeartbeat();
    removeCodexNotificationListener();
    removeCodexConnectionListener();
    await closeCodexClient().catch((error: unknown) => {
      logCodexFailure("codex_runtime.close_failed", error);
    });
    await accountLoop;
    await snapshotRefreshTail;
    try {
      markCodexAccountUnavailable(codexRecords);
    } catch (error) {
      logCodexFailure("codex_runtime.account_snapshot_fail_closed_failed", error);
    }
    codexRecords.close();
    try {
      releaseTerminalManualSnapshots();
    } catch (error) {
      logCodexFailure("manual_authority.terminal_release_failed", error);
    }
    manualSnapshotStore.close();
    manualIssuanceStore.close();
    console.log(`[worker] ${workerId} stopped`);
  }
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
  if (!workerPromise) return Promise.resolve();
  shutdownPromise ??= shutdownCodexRuntime({
    activeRunId,
    activeRunFinished,
    abort: (runId, reason) => runtime.abort(
      harnessRecords.getHarnessRunForProductionRun(runId)?.id ?? runId,
      reason
    ),
    close: closeCodexClient,
    graceMs: Number.isFinite(shutdownGraceMs) ? Math.max(0, shutdownGraceMs) : 5_000,
    onAbortError: (error) => logCodexFailure("worker.shutdown_interrupt_failed", error, {
      runId: activeRunId
    })
  });
  return shutdownPromise;
}

const executedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (executedDirectly) {
  process.on("SIGINT", () => { void stopFactoryWorker(); });
  process.on("SIGTERM", () => { void stopFactoryWorker(); });
  startFactoryWorker().catch((error: unknown) => {
    console.error("[worker] fatal", error);
    process.exitCode = 1;
  });
}
