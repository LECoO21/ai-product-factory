import { z } from "zod";
import {
  ContextManager,
  type HarnessDriver,
  type HarnessDriverRunInput,
  type HarnessToolDefinition,
  type ToolResultEnvelope,
  type ToolGateway
} from "@factory/harness";
import type { AgentAssignment, AgentRuntimeEvent } from "@factory/shared";
import { CodexAccountService } from "./codex-account";
import {
  CodexAppServerClient,
  CodexRpcError,
  type CodexNotification,
  type CodexServerRequest
} from "./codex-app-server-client";

type CodexAssignment = AgentAssignment & {
  scopeId?: string;
  cwd?: string;
  threadId?: string | null;
};

export interface AgentRuntime {
  isConfigured(): boolean;
  run(assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent>;
  steer?(runId: string, message: string): Promise<{ accepted: boolean; reason?: string }>;
  abort?(runId: string, reason: string): Promise<{ accepted: boolean; reason?: string }>;
}

export interface CodexBindingStore {
  getThreadBinding(scopeId: string): { threadId: string } | null;
  saveThreadBinding(scopeId: string, threadId: string): unknown;
  deleteThreadBinding(scopeId: string, expectedThreadId: string): unknown;
  saveTurnBinding(runId: string, threadId: string, turnId: string): unknown;
}

export type CodexDynamicTool = {
  name: string;
  canonicalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(callId: string, args: Record<string, unknown>): Promise<ToolResultEnvelope>;
};

type ActiveTurn = { threadId: string; turnId: string };

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.ended) return { value: undefined, done: true };
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

const now = () => new Date().toISOString();
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const itemIdentity = (item: Record<string, unknown>) => ({
  toolCallId: String(item.id ?? "unknown"),
  toolName: String(item.tool ?? item.type ?? "codex-item")
});

export const createCodexNotificationMapper = () => {
  let streamedText = "";

  return (notification: CodexNotification): AgentRuntimeEvent[] => {
    const params = record(notification.params) ?? {};
    if (notification.method === "turn/started") {
      const turn = record(params.turn);
      return [{
        type: "turn.started",
        payload: { codexTurnId: String(turn?.id ?? "") },
        occurredAt: now()
      }];
    }
    if (notification.method === "item/agentMessage/delta") {
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (!delta) return [];
      streamedText += delta;
      return [{ type: "text.delta", payload: { delta }, occurredAt: now() }];
    }
    if (notification.method === "item/started") {
      const item = record(params.item);
      if (!item || item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan") {
        return [];
      }
      return [{ type: "tool.started", payload: itemIdentity(item), occurredAt: now() }];
    }
    if (notification.method === "item/completed") {
      const item = record(params.item);
      if (!item) return [];
      if (item.type === "agentMessage") {
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!streamedText.trim() && text) {
          streamedText = text;
          return [{ type: "text.delta", payload: { delta: text }, occurredAt: now() }];
        }
        return [];
      }
      if (item.type === "imageGeneration") {
        const savedPath = typeof item.savedPath === "string" && item.savedPath.trim()
          ? item.savedPath.trim()
          : null;
        const failure = record(item.failure);
        const generationSucceeded = item.failure === null;
        return [{
          type: "tool.completed",
          payload: {
            ...itemIdentity(item),
            toolName: "imageGeneration",
            sourceItemType: "imageGeneration",
            lifecycle: "item/completed",
            itemId: String(item.id ?? ""),
            status: String(item.status ?? "unknown"),
            generationSucceeded,
            success: generationSucceeded,
            savedPath,
            resultPresent: typeof item.result === "string" && item.result.length > 0,
            failureType: typeof failure?.type === "string" ? failure.type : null
          },
          occurredAt: now()
        }];
      }
      if (item.type === "reasoning" || item.type === "plan") return [];
      return [{
        type: "tool.completed",
        payload: {
          ...itemIdentity(item),
          status: String(item.status ?? "completed"),
          success: item.success ?? null
        },
        occurredAt: now()
      }];
    }
    if (notification.method === "turn/plan/updated") {
      return [{
        type: "plan.updated",
        payload: {
          explanation: params.explanation ?? null,
          plan: Array.isArray(params.plan) ? params.plan : []
        },
        occurredAt: now()
      }];
    }
    if (notification.method === "turn/completed") {
      const turn = record(params.turn) ?? {};
      const status = String(turn.status ?? "failed");
      if (status === "completed") {
        return [{
          type: "agent.completed",
          payload: { codexTurnId: String(turn.id ?? ""), durationMs: turn.durationMs ?? null },
          occurredAt: now()
        }];
      }
      if (status === "interrupted") {
        return [{
          type: "agent.interrupted",
          payload: { codexTurnId: String(turn.id ?? ""), message: "Codex Turn 已停止" },
          occurredAt: now()
        }];
      }
      const error = record(turn.error);
      return [{
        type: "agent.failed",
        payload: {
          code: "codex_turn_failed",
          message: typeof error?.message === "string" ? error.message : "Codex Turn 执行失败"
        },
        occurredAt: now()
      }];
    }
    return [];
  };
};

type ThreadStartResponse = { thread: { id: string } };
type ThreadResumeResponse = { thread: { id: string } };
type TurnStartResponse = { turn: { id: string; status?: string; error?: unknown; durationMs?: number | null } };

const notificationThreadId = (notification: CodexNotification) => {
  const params = record(notification.params);
  return typeof params?.threadId === "string" ? params.threadId : null;
};

const notificationTurnId = (notification: CodexNotification) => {
  const params = record(notification.params);
  if (typeof params?.turnId === "string") return params.turnId;
  const turn = record(params?.turn);
  return typeof turn?.id === "string" ? turn.id : null;
};

const toTextInput = (text: string) => [{ type: "text", text, text_elements: [] }];

const dynamicToolCallSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  namespace: z.string().nullable().optional()
});

const missingThreadCodes = new Set(["NOT_FOUND", "THREAD_NOT_FOUND"]);

const normalizedErrorCode = (value: unknown) =>
  typeof value === "string" ? value.trim().toUpperCase().replaceAll("-", "_") : value;

export const isMissingCodexThreadError = (error: unknown) => {
  if (!(error instanceof Error) || error.name !== "CodexRpcError" || !("code" in error)) return false;
  const rpcError = error as CodexRpcError;
  const code = normalizedErrorCode(rpcError.code);
  if (code === 404 || (typeof code === "string" && missingThreadCodes.has(code))) return true;
  const data = record(rpcError.data);
  const dataCode = normalizedErrorCode(data?.code ?? data?.type);
  if (dataCode === 404 || (typeof dataCode === "string" && missingThreadCodes.has(dataCode))) {
    return true;
  }
  return /(?:thread|conversation|线程|会话).*(?:not[ _-]?found|不存在|未找到)/i.test(rpcError.message);
};

export type CodexAppServerRuntimeOptions = {
  client: CodexAppServerClient;
  bindings?: CodexBindingStore;
  defaultCwd?: string;
  turnTimeoutMs?: number;
};

export class CodexAppServerRuntime implements AgentRuntime {
  private readonly account: CodexAccountService;
  private readonly active = new Map<string, ActiveTurn>();
  private readonly defaultCwd: string;
  private readonly turnTimeoutMs: number;

  constructor(private readonly options: CodexAppServerRuntimeOptions) {
    this.account = new CodexAccountService(options.client);
    this.defaultCwd = options.defaultCwd ?? process.cwd();
    this.turnTimeoutMs = options.turnTimeoutMs ?? Number(process.env.CODEX_TURN_TIMEOUT_MS ?? 30 * 60_000);
  }

  isConfigured() {
    return true;
  }

  run(assignment: AgentAssignment) {
    return this.runWithTools(assignment, []);
  }

  runWithTools(assignment: AgentAssignment, tools: CodexDynamicTool[]): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    void this.execute(assignment as CodexAssignment, tools, queue).catch((error) => {
      queue.push({
        type: "agent.failed",
        payload: {
          code: "codex_app_server_error",
          message: error instanceof Error ? error.message : "Codex App Server 执行失败"
        },
        occurredAt: now()
      });
      queue.end();
    });
    return queue;
  }

  private async execute(
    assignment: CodexAssignment,
    tools: CodexDynamicTool[],
    queue: AsyncEventQueue<AgentRuntimeEvent>
  ) {
    const client = this.options.client;
    await client.start();
    const account = await this.account.read(false);
    if (!account.authenticated) {
      queue.push({
        type: "agent.failed",
        payload: { code: "openai_auth_required", message: "请先登录自己的 OpenAI 账户" },
        occurredAt: now()
      });
      queue.end();
      return;
    }

    const scopeId = assignment.scopeId ?? assignment.runId;
    const cwd = assignment.cwd ?? this.defaultCwd;
    const storedThreadId = assignment.threadId ?? this.options.bindings?.getThreadBinding(scopeId)?.threadId;
    const startThread = async () => {
      const started = await client.request<ThreadStartResponse>("thread/start", {
        ...(assignment.model && assignment.model !== "account-default" ? { model: assignment.model } : {}),
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        developerInstructions: assignment.systemPrompt,
        ephemeral: false,
        ...(tools.length > 0 ? {
          dynamicTools: tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        } : {})
      });
      this.options.bindings?.saveThreadBinding(scopeId, started.thread.id);
      return started.thread.id;
    };
    let threadId: string;
    if (storedThreadId) {
      try {
        const resumed = await client.request<ThreadResumeResponse>("thread/resume", {
          threadId: storedThreadId,
          cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          developerInstructions: assignment.systemPrompt,
          excludeTurns: true
        });
        threadId = resumed.thread.id;
      } catch (error) {
        if (!isMissingCodexThreadError(error)) throw error;
        this.options.bindings?.deleteThreadBinding(scopeId, storedThreadId);
        threadId = await startThread();
      }
    } else {
      threadId = await startThread();
    }

    queue.push({
      type: "agent.started",
      payload: { runtime: "codex-app-server", codexThreadId: threadId },
      occurredAt: now()
    });

    let expectedTurnId: string | null = null;
    let terminal = false;
    let timedOut = false;
    let resolveTerminal!: () => void;
    const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const mapNotification = createCodexNotificationMapper();
    const removeNotification = client.onNotification((notification) => {
      if (terminal) return;
      if (notificationThreadId(notification) !== threadId) return;
      const incomingTurnId = notificationTurnId(notification);
      if (incomingTurnId && expectedTurnId && incomingTurnId !== expectedTurnId) return;
      if (incomingTurnId && !expectedTurnId) expectedTurnId = incomingTurnId;
      for (const event of mapNotification(notification)) queue.push(event);
      if (notification.method === "turn/completed") {
        terminal = true;
        resolveTerminal();
      }
    });
    const removeConnectionClosed = client.onConnectionClosed(() => {
      if (terminal) return;
      queue.push({
        type: "agent.failed",
        payload: {
          code: "codex_connection_closed",
          message: "Codex App Server 连接已断开，可稍后从当前产品继续"
        },
        occurredAt: now()
      });
      terminal = true;
      resolveTerminal();
    });
    const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
    const contextManager = new ContextManager();
    const removeServerRequest = client.onServerRequest(async (request: CodexServerRequest) => {
      if (request.method !== "item/tool/call") return { handled: false };
      const parsed = dynamicToolCallSchema.safeParse(request.params);
      if (!parsed.success) return { handled: false };
      const params = parsed.data;
      if (
        params.threadId !== threadId
        || !expectedTurnId
        || params.turnId !== expectedTurnId
      ) return { handled: false };
      const tool = toolByName.get(params.tool);
      if (!tool) {
        return {
          handled: true,
          result: {
            contentItems: [{ type: "inputText", text: "该工具未在当前生产单中注册" }],
            success: false
          }
        };
      }
      const result = await tool.execute(params.callId, params.arguments);
      const trimmed = contextManager.trimToolResult(result);
      return {
        handled: true,
        result: {
          contentItems: [{ type: "inputText", text: JSON.stringify(trimmed) }],
          success: trimmed.status === "succeeded"
        }
      };
    });

    const timeout = setTimeout(() => {
      if (terminal) return;
      timedOut = true;
      queue.push({
        type: "agent.failed",
        payload: { code: "codex_turn_timeout", message: "Codex 处理超时，可稍后从当前产品继续" },
        occurredAt: now()
      });
      terminal = true;
      resolveTerminal();
    }, this.turnTimeoutMs);

    try {
      const turn = await client.request<TurnStartResponse>("turn/start", {
        threadId,
        clientUserMessageId: assignment.runId,
        input: toTextInput(assignment.prompt),
        ...(assignment.model && assignment.model !== "account-default" ? { model: assignment.model } : {}),
        effort: assignment.thinkingLevel === "off" ? "minimal" : assignment.thinkingLevel
      });
      expectedTurnId = turn.turn.id;
      this.active.set(assignment.runId, { threadId, turnId: expectedTurnId });
      this.options.bindings?.saveTurnBinding(assignment.runId, threadId, expectedTurnId);
      if (turn.turn.status && turn.turn.status !== "inProgress" && !terminal) {
        for (const event of mapNotification({
          method: "turn/completed",
          params: { threadId, turn: turn.turn }
        })) queue.push(event);
        terminal = true;
        resolveTerminal();
      }
      await terminalPromise;
      if (timedOut && expectedTurnId && client.isReady()) {
        await client.request("turn/interrupt", {
          threadId,
          turnId: expectedTurnId
        }, 5_000).catch(() => undefined);
      }
    } catch (error) {
      if (!terminal) throw error;
    } finally {
      clearTimeout(timeout);
      this.active.delete(assignment.runId);
      removeNotification();
      removeConnectionClosed();
      removeServerRequest();
      queue.end();
    }
  }

  async steer(runId: string, message: string) {
    const active = this.active.get(runId);
    if (!active) return { accepted: false, reason: "当前没有可引导的 Codex Turn" };
    await this.options.client.request("turn/steer", {
      threadId: active.threadId,
      expectedTurnId: active.turnId,
      input: toTextInput(message)
    });
    return { accepted: true };
  }

  async abort(runId: string, _reason: string) {
    const active = this.active.get(runId);
    if (!active) return { accepted: false, reason: "当前没有可停止的 Codex Turn" };
    await this.options.client.request("turn/interrupt", active);
    return { accepted: true };
  }
}

const descriptions: Record<string, string> = {
  "manual.verify": "校验三份最高权威原始手册的完整性",
  "manual.load": "读取本产品流程已经锁定的三份原始手册快照",
  "workspace.list": "列出当前独立工作区内的文件",
  "workspace.read": "读取当前独立工作区内的文本文件",
  "workspace.search": "搜索当前独立工作区内的文本",
  "workspace.patch": "使用带预期 hash 的补丁修改当前独立工作区",
  "git.inspect": "只读查看当前工作区的 Git 状态、差异或历史",
  "command.run": "运行受程序与参数白名单约束的命令",
  "test.run": "运行测试、类型、Lint 或构建并登记真实报告",
  "workplan.update": "更新用户可见工作计划",
  "task.manage": "读取或更新当前 Task",
  "background.manage": "读取或取消当前 Task 的后台执行",
  "artifact.register": "登记工作区中已经存在的真实产物",
  "evidence.register": "登记完成标准的真实证据"
};

const toolAlias = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

export const createCodexDynamicTools = (
  definitions: HarnessToolDefinition[],
  gateway: ToolGateway,
  harnessRunId: string
): CodexDynamicTool[] => {
  const aliases = new Set<string>();
  return definitions.map((definition) => {
    const name = toolAlias(definition.name);
    if (!name || aliases.has(name)) throw new Error(`Codex 工具名冲突：${definition.name}`);
    aliases.add(name);
    const schema = z.toJSONSchema(definition.schema) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name,
      canonicalName: definition.name,
      description: `${descriptions[definition.name] ?? definition.name}（内部工具：${definition.name}）`,
      inputSchema: schema,
      execute: (toolCallId, args) => gateway.execute({
        harnessRunId,
        toolCallId,
        toolName: definition.name,
        args
      })
    };
  });
};

export class CodexHarnessDriver implements HarnessDriver {
  constructor(
    private readonly runtime: CodexAppServerRuntime,
    private readonly assignment: AgentAssignment,
    private readonly tools: CodexDynamicTool[]
  ) {}

  async run(input: HarnessDriverRunInput) {
    let summary = "";
    let outcome: "completed" | "failed" | "aborted" = "failed";
    for await (const event of this.runtime.runWithTools(
      { ...this.assignment, prompt: input.prompt },
      this.tools
    )) {
      if (event.type === "text.delta") summary += String(event.payload.delta ?? "");
      if (event.type === "agent.completed") outcome = "completed";
      if (event.type === "agent.interrupted") outcome = "aborted";
      if (event.type === "agent.failed") {
        outcome = "failed";
        summary = String(event.payload.message ?? (summary || "Codex 执行失败"));
      }
    }
    if (outcome === "completed") {
      return { kind: "completed" as const, summary: summary.trim() || "Codex Turn 已完成" };
    }
    if (outcome === "aborted") return { kind: "aborted" as const, summary: "Codex Turn 已停止" };
    return { kind: "failed" as const, summary: summary.trim() || "Codex Turn 未正常完成" };
  }

  async steer(message: string) {
    return this.runtime.steer(this.assignment.runId, message);
  }

  async abort(reason: string) {
    return this.runtime.abort(this.assignment.runId, reason);
  }
}

export const createProductionCodexHarnessDriver = (options: {
  runtime: CodexAppServerRuntime;
  workspaceRoot: string;
  runId: string;
  systemPrompt: string;
  gateway: ToolGateway;
  definitions: HarnessToolDefinition[];
}) => new CodexHarnessDriver(
  options.runtime,
  {
    runId: options.runId,
    systemPrompt: options.systemPrompt,
    prompt: "",
    model: process.env.CODEX_MODEL?.trim() || "account-default",
    thinkingLevel: "low",
    scopeId: `harness:${options.runId}`,
    cwd: options.workspaceRoot
  },
  createCodexDynamicTools(options.definitions, options.gateway, options.runId)
);

export class InMemoryAgentRuntime implements AgentRuntime {
  constructor(private readonly script: AgentRuntimeEvent[]) {}

  isConfigured() {
    return true;
  }

  async *run(_assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent> {
    for (const event of this.script) yield event;
  }
}
