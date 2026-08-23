import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type { AgentAssignment, AgentRuntimeEvent } from "@factory/shared";

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
  constructor(private readonly apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "") {}

  isConfigured() {
    return this.apiKey.length > 0;
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

    const models = createModels();
    models.setProvider(deepseekProvider());
    const model = models.getModel("deepseek", assignment.model);
    if (!model) {
      queue.push({
        type: "agent.failed",
        payload: { code: "deepseek_model_unknown", message: `未知 DeepSeek 模型：${assignment.model}` },
        occurredAt: now()
      });
      queue.end();
      return queue;
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: assignment.systemPrompt,
        model,
        thinkingLevel: assignment.thinkingLevel
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) => (provider === "deepseek" ? this.apiKey : undefined),
      sessionId: assignment.runId,
      toolExecution: "sequential"
    });

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
