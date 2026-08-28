import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  JsonlSessionRepo,
  type AgentEvent,
  type AgentMessage,
  type AgentTool
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { Type } from "typebox";
import type { HarnessDriver, HarnessDriverRunInput, ToolGateway } from "@factory/harness";
import { DeepSeekPiAgentFactory } from "./model-provider";

type PiMessageLike = {
  role: string;
  content?: string | ReadonlyArray<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
};

export type PiAgentStateSnapshot = {
  messages: ReadonlyArray<PiMessageLike>;
  isStreaming: boolean;
  errorMessage?: string;
};

export interface PiAgentPort {
  readonly state: PiAgentStateSnapshot;
  prompt(message: string): Promise<void>;
  steer(message: string): void;
  abort(): void;
}

const lastAssistantMessage = (state: PiAgentStateSnapshot) =>
  [...state.messages].reverse().find((message) => message.role === "assistant");

const messageText = (message: PiMessageLike | undefined) => {
  if (typeof message?.content === "string") return message.content.trim();
  return message?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim() ?? "";
};

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(stripUndefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, stripUndefined(nested)])
    );
  }
  return value;
};

export const toDurableAgentMessage = (message: unknown): AgentMessage =>
  stripUndefined(message) as AgentMessage;

export class PiAgentHarnessDriver implements HarnessDriver {
  constructor(private readonly agent: PiAgentPort) {}

  async run(input: HarnessDriverRunInput) {
    await this.agent.prompt(input.prompt);
    const state = this.agent.state;
    const finalMessage = lastAssistantMessage(state);
    const summary = messageText(finalMessage);
    if (finalMessage?.stopReason === "aborted") {
      return { kind: "aborted" as const, summary: "Pi Agent 已停止" };
    }
    if (finalMessage?.stopReason === "error" || state.errorMessage) {
      return {
        kind: "failed" as const,
        summary: finalMessage?.errorMessage || state.errorMessage || summary || "Pi Agent 执行失败"
      };
    }
    return { kind: "completed" as const, summary: summary || "Pi Agent 已结束" };
  }

  async steer(message: string) {
    this.agent.steer(message);
    return { accepted: true };
  }

  async abort(_reason: string) {
    this.agent.abort();
    return { accepted: true };
  }
}

const anyObject = Type.Object({}, { additionalProperties: true });
const toolSchemas: Record<string, ReturnType<typeof Type.Object>> = {
  "manual.verify": Type.Object({ authorityVersion: Type.String() }),
  "manual.load": Type.Object({ stage: Type.Literal("v0.2-b") }),
  "workspace.list": Type.Object({ path: Type.Optional(Type.String()), depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
  "workspace.read": Type.Object({ path: Type.String(), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })), maxBytes: Type.Optional(Type.Integer({ maximum: 262144 })) }),
  "workspace.search": Type.Object({ query: Type.String(), paths: Type.Optional(Type.Array(Type.String())), limit: Type.Optional(Type.Integer({ maximum: 200 })) }),
  "workspace.patch": Type.Object({ patch: Type.String(), expectedHashes: Type.Record(Type.String(), Type.String()) }),
  "git.inspect": Type.Object({ operation: Type.Union([Type.Literal("status"), Type.Literal("diff"), Type.Literal("log")]), maxEntries: Type.Optional(Type.Integer({ maximum: 100 })) }),
  "command.run": Type.Object({ program: Type.Union([Type.Literal("npm"), Type.Literal("node"), Type.Literal("git")]), args: Type.Array(Type.String()), cwd: Type.String(), timeoutMs: Type.Integer({ maximum: 180000 }) }),
  "test.run": Type.Object({ script: Type.Union([Type.Literal("test"), Type.Literal("typecheck"), Type.Literal("lint"), Type.Literal("build")]), cwd: Type.String(), target: Type.Optional(Type.String()) }),
  "workplan.update": Type.Object({ items: Type.Array(Type.Object({ id: Type.String(), text: Type.String(), status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]) })) }),
  "task.manage": Type.Object({
    action: Type.Union([Type.Literal("get"), Type.Literal("update")]),
    taskId: Type.String(),
    status: Type.Optional(Type.Union([
      Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("blocked"),
      Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("interrupted")
    ])),
    note: Type.Optional(Type.String())
  }),
  "background.manage": Type.Object({ action: Type.Union([Type.Literal("get"), Type.Literal("cancel")]), jobId: Type.String() }),
  "artifact.register": Type.Object({ kind: Type.String(), path: Type.String(), mimeType: Type.String(), sourceToolCallId: Type.String() }),
  "evidence.register": Type.Object({
    criterionId: Type.String(),
    kind: Type.String(),
    artifactId: Type.Optional(Type.String()),
    observation: Type.Record(Type.String(), Type.Unknown()),
    passed: Type.Boolean()
  })
};

const toolDescriptions: Record<string, string> = {
  "manual.verify": "校验三份最高权威原始手册的 SHA256 完整性",
  "manual.load": "按固定顺序加载当前阶段需要的三份原始手册",
  "workspace.list": "列出当前独立工作区内的文件",
  "workspace.read": "读取当前独立工作区内的文本文件",
  "workspace.search": "搜索当前独立工作区内的文本",
  "workspace.patch": "使用带预期 hash 的 unified patch 修改当前独立工作区",
  "git.inspect": "只读查看当前工作区的 Git status、diff 或 log",
  "command.run": "运行受程序与参数白名单约束的命令，不使用 Shell",
  "test.run": "运行 test、typecheck、lint 或 build 并登记真实报告",
  "workplan.update": "更新本次运行的用户可见工作计划",
  "task.manage": "读取或更新当前 Task",
  "background.manage": "读取或取消当前 Task 的后台执行",
  "artifact.register": "登记工作区中已经存在的真实产物",
  "evidence.register": "登记完成标准的真实证据"
};

const toModelToolName = (canonicalName: string) => canonicalName.replace(/[^a-zA-Z0-9_-]/g, "_");

export const createPiTools = (gateway: ToolGateway, harnessRunId: string, names: string[]): AgentTool[] => {
  const aliases = new Set<string>();
  return names.map((name) => {
    const alias = toModelToolName(name);
    if (!alias || aliases.has(alias)) throw new Error(`模型工具名冲突：${name}`);
    aliases.add(alias);
    return {
      name: alias,
      label: name,
      description: `${toolDescriptions[name] ?? name}（内部工具：${name}）`,
      parameters: toolSchemas[name] ?? anyObject,
      executionMode: "sequential" as const,
      execute: async (toolCallId, params, signal) => {
        const envelope = await gateway.execute({
          harnessRunId,
          toolCallId,
          toolName: name,
          args: params as Record<string, unknown>,
          ...(signal ? { signal } : {})
        });
        if (envelope.status === "failed") throw new Error(envelope.summary);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
          details: envelope,
          ...(["approval_required", "denied"].includes(envelope.status) ? { terminate: true } : {})
        };
      }
    };
  });
};

export const createProductionPiHarnessDriver = async (options: {
  apiKey: string;
  modelName: string;
  dataRoot: string;
  workspaceRoot: string;
  runId: string;
  systemPrompt: string;
  gateway: ToolGateway;
  toolNames: string[];
}) => {
  const factory = new DeepSeekPiAgentFactory(options.apiKey);

  const sessionsRoot = join(options.dataRoot, "harness-sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const environment = new NodeExecutionEnv({ cwd: options.workspaceRoot });
  const sessions = new JsonlSessionRepo({ fs: environment, sessionsRoot });
  const existingSession = (await sessions.list({ cwd: options.workspaceRoot }))
    .find((metadata) => metadata.id === options.runId);
  const session = existingSession
    ? await sessions.open(existingSession)
    : await sessions.create({ id: options.runId, cwd: options.workspaceRoot });
  const previousMessages = (await session.findEntriesOnBranch({ type: "message", order: "oldestFirst" }))
    .map((entry) => entry.type === "message" ? entry.message : null)
    .filter((message): message is AgentMessage => message !== null);
  const agent = factory.create({
    sessionId: options.runId,
    systemPrompt: options.systemPrompt,
    modelName: options.modelName,
    thinkingLevel: "low",
    tools: createPiTools(options.gateway, options.runId, options.toolNames),
    messages: previousMessages,
    maxRetryDelayMs: 90_000
  });

  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === "message_end") {
      await session.appendMessage(toDurableAgentMessage(event.message));
      return;
    }
    if (event.type === "tool_execution_start") {
      await session.appendCustomEntry("tool_execution_start", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      await session.appendCustomEntry("tool_execution_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError
      });
      return;
    }
    if (event.type === "agent_start" || event.type === "agent_end") {
      await session.appendCustomEntry(event.type, event.type === "agent_end"
        ? { messageCount: event.messages.length }
        : {});
    }
  });

  const port: PiAgentPort = {
    get state() { return agent.state; },
    prompt: (message) => agent.prompt(message),
    steer: (message) => agent.steer({
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now()
    }),
    abort: () => agent.abort()
  };
  return new PiAgentHarnessDriver(port);
};
