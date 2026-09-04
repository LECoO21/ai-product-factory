import { z } from "zod";
import type { AgentAssignment, AgentRuntimeEvent } from "@factory/shared";
import type {
  HarnessDriver,
  HarnessDriverRunInput,
  HarnessToolDefinition,
  ToolGateway,
  ToolResultEnvelope
} from "@factory/harness";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_MAX_TOOL_ROUNDS = 20;

export type DeepSeekDynamicTool = {
  name: string;
  canonicalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(callId: string, args: Record<string, unknown>): Promise<ToolResultEnvelope>;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

/**
 * DeepSeek 运行时：既做纯文本生成（技术环节），也支持 function calling
 * 调用 Harness 工具（改文件、跑测试等），从而完全替代 Codex。
 */
export class DeepSeekRuntime {
  private readonly active = new Map<string, AbortController>();

  private get apiKey() {
    return process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  }

  private get model() {
    return process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro";
  }

  private get baseUrl() {
    return process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;
  }

  isConfigured() {
    return this.apiKey.length > 0;
  }

  private async chat(messages: ChatMessage[], tools?: DeepSeekDynamicTool[], signal?: AbortSignal) {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools && tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema
                }
              }))
            }
          : {}),
        stream: false,
        max_tokens: DEFAULT_MAX_TOKENS
      }),
      ...(signal ? { signal } : {})
    });
  }

  async *run(assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent> {
    const now = () => new Date().toISOString();
    if (!this.isConfigured()) {
      yield {
        type: "agent.failed",
        payload: { code: "deepseek_not_configured", message: "尚未配置 DEEPSEEK_API_KEY" },
        occurredAt: now()
      };
      return;
    }

    yield { type: "agent.started", payload: { runtime: "deepseek", model: this.model }, occurredAt: now() };

    const controller = new AbortController();
    this.active.set(assignment.runId, controller);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: assignment.systemPrompt },
            { role: "user", content: assignment.prompt }
          ],
          stream: true,
          max_tokens: DEFAULT_MAX_TOKENS
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        yield {
          type: "agent.failed",
          payload: { code: "deepseek_api_error", message: `DeepSeek 调用失败（${response.status}）：${text.slice(0, 500)}` },
          occurredAt: now()
        };
        return;
      }
      if (!response.body) {
        yield { type: "agent.failed", payload: { code: "deepseek_empty_response", message: "DeepSeek 返回空响应" }, occurredAt: now() };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasContent = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              hasContent = true;
              yield { type: "text.delta", payload: { delta }, occurredAt: now() };
            }
          } catch {
            // 忽略无法解析的 SSE 行
          }
        }
      }

      if (!hasContent) {
        yield { type: "agent.failed", payload: { code: "deepseek_no_content", message: "DeepSeek 未生成文本内容" }, occurredAt: now() };
        return;
      }

      yield { type: "agent.completed", payload: { runtime: "deepseek", model: this.model }, occurredAt: now() };
    } catch (error) {
      if (controller.signal.aborted) {
        yield { type: "agent.interrupted", payload: { message: "DeepSeek 调用已停止" }, occurredAt: now() };
        return;
      }
      yield {
        type: "agent.failed",
        payload: { code: "deepseek_error", message: error instanceof Error ? error.message : "DeepSeek 调用失败" },
        occurredAt: now()
      };
    } finally {
      this.active.delete(assignment.runId);
    }
  }

  async *runWithTools(
    assignment: AgentAssignment,
    tools: DeepSeekDynamicTool[]
  ): AsyncIterable<AgentRuntimeEvent> {
    const now = () => new Date().toISOString();
    if (!this.isConfigured()) {
      yield {
        type: "agent.failed",
        payload: { code: "deepseek_not_configured", message: "尚未配置 DEEPSEEK_API_KEY" },
        occurredAt: now()
      };
      return;
    }

    yield { type: "agent.started", payload: { runtime: "deepseek", model: this.model }, occurredAt: now() };

    const controller = new AbortController();
    this.active.set(assignment.runId, controller);
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: assignment.systemPrompt },
        { role: "user", content: assignment.prompt }
      ];
      const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

      for (let round = 0; round < DEFAULT_MAX_TOOL_ROUNDS; round += 1) {
        const response = await this.chat(messages, tools, controller.signal);
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          yield {
            type: "agent.failed",
            payload: { code: "deepseek_api_error", message: `DeepSeek 调用失败（${response.status}）：${text.slice(0, 500)}` },
            occurredAt: now()
          };
          return;
        }

        const data = (await response.json()) as {
          choices?: Array<{
            message?: {
              role?: string;
              content?: string | null;
              reasoning_content?: string;
              tool_calls?: ChatMessage["tool_calls"];
            };
          }>;
        };
        const message = data.choices?.[0]?.message;
        if (!message) {
          yield { type: "agent.failed", payload: { code: "deepseek_empty_response", message: "DeepSeek 返回空响应" }, occurredAt: now() };
          return;
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          messages.push({
            role: "assistant",
            content: message.content ?? null,
            ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
            tool_calls: message.tool_calls
          });
          for (const call of message.tool_calls) {
            const tool = toolMap.get(call.function.name);
            yield {
              type: "tool.started",
              payload: { toolCallId: call.id, toolName: call.function.name },
              occurredAt: now()
            };
            if (!tool) {
              messages.push({ role: "tool", tool_call_id: call.id, content: "该工具未在当前生产单中注册" });
              yield {
                type: "tool.completed",
                payload: { toolCallId: call.id, toolName: call.function.name, status: "failed", success: false },
                occurredAt: now()
              };
              continue;
            }
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
            } catch {
              args = {};
            }
            const result = await tool.execute(call.id, args);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
            yield {
              type: "tool.completed",
              payload: {
                toolCallId: call.id,
                toolName: call.function.name,
                status: result.status,
                success: result.status === "succeeded"
              },
              occurredAt: now()
            };
          }
          continue;
        }

        const content = message.content ?? "";
        if (content.trim().length === 0) {
          yield { type: "agent.failed", payload: { code: "deepseek_no_content", message: "DeepSeek 未生成文本内容" }, occurredAt: now() };
          return;
        }
        yield { type: "text.delta", payload: { delta: content }, occurredAt: now() };
        yield { type: "agent.completed", payload: { runtime: "deepseek", model: this.model }, occurredAt: now() };
        return;
      }

      yield {
        type: "agent.failed",
        payload: { code: "deepseek_tool_rounds_exhausted", message: `工具调用超过 ${DEFAULT_MAX_TOOL_ROUNDS} 轮仍未完成` },
        occurredAt: now()
      };
    } catch (error) {
      if (controller.signal.aborted) {
        yield { type: "agent.interrupted", payload: { message: "DeepSeek 调用已停止" }, occurredAt: now() };
        return;
      }
      yield {
        type: "agent.failed",
        payload: { code: "deepseek_error", message: error instanceof Error ? error.message : "DeepSeek 调用失败" },
        occurredAt: now()
      };
    } finally {
      this.active.delete(assignment.runId);
    }
  }

  async steer(_runId: string, _message: string): Promise<{ accepted: boolean; reason?: string }> {
    return { accepted: false, reason: "DeepSeek 生成不支持中途引导" };
  }

  async abort(runId: string, _reason: string): Promise<{ accepted: boolean; reason?: string }> {
    const controller = this.active.get(runId);
    if (!controller) return { accepted: false, reason: "当前没有可停止的 DeepSeek 调用" };
    controller.abort();
    return { accepted: true };
  }
}

const toolDescriptions: Record<string, string> = {
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

export const createDeepSeekDynamicTools = (
  definitions: HarnessToolDefinition[],
  gateway: ToolGateway,
  harnessRunId: string
): DeepSeekDynamicTool[] =>
  definitions.map((definition) => {
    const schema = z.toJSONSchema(definition.schema) as Record<string, unknown>;
    delete schema.$schema;
    const name = toolAlias(definition.name);
    if (!name) throw new Error(`工具名无效：${definition.name}`);
    return {
      name,
      canonicalName: definition.name,
      description: `${toolDescriptions[definition.name] ?? definition.name}（内部工具：${definition.name}）`,
      inputSchema: schema,
      execute: (toolCallId, args) =>
        gateway.execute({ harnessRunId, toolCallId, toolName: definition.name, args })
    };
  });

export class DeepSeekHarnessDriver implements HarnessDriver {
  constructor(
    private readonly runtime: DeepSeekRuntime,
    private readonly assignment: AgentAssignment,
    private readonly tools: DeepSeekDynamicTool[]
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
        summary = String(event.payload.message ?? (summary || "DeepSeek 执行失败"));
      }
    }
    if (outcome === "completed") {
      return { kind: "completed" as const, summary: summary.trim() || "DeepSeek 已完成" };
    }
    if (outcome === "aborted") return { kind: "aborted" as const, summary: "DeepSeek 调用已停止" };
    return { kind: "failed" as const, summary: summary.trim() || "DeepSeek 未正常完成" };
  }

  async steer(message: string) {
    return this.runtime.steer(this.assignment.runId, message);
  }

  async abort(reason: string) {
    return this.runtime.abort(this.assignment.runId, reason);
  }
}

export const createDeepSeekHarnessDriver = (options: {
  runtime: DeepSeekRuntime;
  workspaceRoot: string;
  runId: string;
  systemPrompt: string;
  gateway: ToolGateway;
  definitions: HarnessToolDefinition[];
}) =>
  new DeepSeekHarnessDriver(
    options.runtime,
    {
      runId: options.runId,
      systemPrompt: options.systemPrompt,
      prompt: "",
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
      thinkingLevel: "low",
      scopeId: `harness:${options.runId}`,
      cwd: options.workspaceRoot
    },
    createDeepSeekDynamicTools(options.definitions, options.gateway, options.runId)
  );
