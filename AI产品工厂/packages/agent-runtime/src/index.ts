import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AgentAssignment, AgentRuntimeEvent } from "@factory/shared";
import { DeepSeekPiAgentFactory, type PiAgentFactory } from "./model-provider";

export * from "./pi-harness-adapter";
export * from "./model-provider";
export * from "./prompts/factory-harness-v1";

export interface AgentRuntime {
  isConfigured(): boolean;
  run(assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent>;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
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

export const createPiEventMapper = () => {
  let streamedText = "";

  return (event: AgentEvent): AgentRuntimeEvent[] => {
    switch (event.type) {
      case "agent_start":
        return [{ type: "agent.started", payload: {}, occurredAt: now() }];
      case "turn_start":
        return [{ type: "turn.started", payload: {}, occurredAt: now() }];
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          streamedText += event.assistantMessageEvent.delta;
          return [
            {
              type: "text.delta",
              payload: { delta: event.assistantMessageEvent.delta },
              occurredAt: now()
            }
          ];
        }
        return [];
      case "tool_execution_start":
        return [
          {
            type: "tool.started",
            payload: { toolCallId: event.toolCallId, toolName: event.toolName },
            occurredAt: now()
          }
        ];
      case "tool_execution_end":
        return [
          {
            type: "tool.completed",
            payload: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              isError: event.isError
            },
            occurredAt: now()
          }
        ];
      case "agent_end": {
        const mapped: AgentRuntimeEvent[] = [];
        if (!streamedText.trim()) {
          const finalText = event.messages
            .flatMap((message) => (message.role === "assistant" ? message.content : []))
            .map((content) => (content.type === "text" ? content.text : ""))
            .filter(Boolean)
            .join("\n")
            .trim();
          if (finalText) {
            mapped.push({
              type: "text.delta",
              payload: { delta: finalText },
              occurredAt: now()
            });
          }
        }
        mapped.push({
          type: "agent.completed",
          payload: { messageCount: event.messages.length },
          occurredAt: now()
        });
        return mapped;
      }
      default:
        return [];
    }
  };
};

export class PiAgentRuntime implements AgentRuntime {
  private readonly factory: PiAgentFactory;

  constructor(factoryOrApiKey: PiAgentFactory | string = new DeepSeekPiAgentFactory()) {
    this.factory = typeof factoryOrApiKey === "string"
      ? new DeepSeekPiAgentFactory(factoryOrApiKey)
      : factoryOrApiKey;
  }

  isConfigured() {
    return this.factory.isConfigured();
  }

  run(assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();

    if (!this.isConfigured()) {
      queue.push({
        type: "agent.failed",
        payload: { code: "deepseek_key_missing", message: "尚未配置 DEEPSEEK_API_KEY" },
        occurredAt: now()
      });
      queue.end();
      return queue;
    }

    let agent;
    try {
      agent = this.factory.create({
        sessionId: assignment.runId,
        systemPrompt: assignment.systemPrompt,
        modelName: assignment.model,
        thinkingLevel: assignment.thinkingLevel
      });
    } catch (error) {
      queue.push({
        type: "agent.failed",
        payload: {
          code: "model_provider_error",
          message: error instanceof Error ? error.message : "模型提供方初始化失败"
        },
        occurredAt: now()
      });
      queue.end();
      return queue;
    }

    const mapPiEvent = createPiEventMapper();
    agent.subscribe((event) => {
      for (const mapped of mapPiEvent(event)) queue.push(mapped);
    });

    void agent
      .prompt(assignment.prompt)
      .catch((error: unknown) => {
        queue.push({
          type: "agent.failed",
          payload: {
            code: "agent_runtime_error",
            message: error instanceof Error ? error.message : "Pi Agent 执行失败"
          },
          occurredAt: now()
        });
      })
      .finally(() => queue.end());

    return queue;
  }
}

export class InMemoryAgentRuntime implements AgentRuntime {
  constructor(private readonly script: AgentRuntimeEvent[]) {}

  isConfigured() {
    return true;
  }

  async *run(_assignment: AgentAssignment): AsyncIterable<AgentRuntimeEvent> {
    for (const event of this.script) yield event;
  }
}
