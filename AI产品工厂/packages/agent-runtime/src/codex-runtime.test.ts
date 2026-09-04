import { describe, expect, it } from "vitest";
import type { AgentAssignment } from "@factory/shared";
import {
  CodexAppServerClient,
  CodexRpcError,
  type CodexTransport,
  type CodexTransportHandlers
} from "./codex-app-server-client";
import {
  CodexAppServerRuntime,
  InMemoryAgentRuntime,
  createCodexNotificationMapper,
  isMissingCodexThreadError,
  type CodexBindingStore
} from "./codex-runtime";

type RpcFailure = { code: number; message: string; data?: unknown };
type ServerToolCall = {
  threadId: string;
  turnId: string;
  callId?: string;
  tool: string;
  arguments: Record<string, unknown>;
};

class RuntimeTransport implements CodexTransport {
  handlers: CodexTransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(
    private readonly authenticated = true,
    private readonly turnEnd: "completed" | "closed" | "hanging" = "completed",
    private readonly resumeFailure: RpcFailure | null = null,
    private readonly serverToolCall: ServerToolCall | null = null
  ) {}

  async start(handlers: CodexTransportHandlers) {
    this.handlers = handlers;
  }

  async send(value: unknown) {
    const message = value as Record<string, unknown>;
    this.sent.push(message);
    if (message.method === "initialize") {
      this.emit({ id: message.id, result: { userAgent: "codex-test" } });
    } else if (message.method === "account/read") {
      this.emit({
        id: message.id,
        result: {
          account: this.authenticated ? { type: "chatgpt", email: null, planType: "plus" } : null,
          requiresOpenaiAuth: true
        }
      });
    } else if (message.method === "thread/start") {
      this.emit({ id: message.id, result: { thread: { id: "thread-1" } } });
    } else if (message.method === "thread/resume") {
      if (this.resumeFailure) this.emit({ id: message.id, error: this.resumeFailure });
      else this.emit({ id: message.id, result: { thread: { id: "thread-1" } } });
    } else if (message.method === "turn/start") {
      this.emit({ id: message.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
      queueMicrotask(() => {
        this.emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
        if (this.serverToolCall) {
          this.emit({
            id: "server-tool-1",
            method: "item/tool/call",
            params: this.serverToolCall
          });
          return;
        }
        if (this.turnEnd === "closed") {
          this.handlers?.onClose(new Error("process exited"));
          return;
        }
        if (this.turnEnd === "hanging") return;
        this.emit({
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", turnId: "turn-1", itemId: "message-1", delta: "真实结果" }
        });
        this.emit({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", durationMs: 12 } }
        });
      });
    } else if (message.method === "turn/interrupt") {
      this.emit({ id: message.id, result: {} });
    } else if (message.id === "server-tool-1") {
      queueMicrotask(() => {
        this.emit({
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", turnId: "turn-1", itemId: "message-1", delta: "工具处理完成" }
        });
        this.emit({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } }
        });
      });
    }
  }

  emit(message: unknown) {
    this.handlers?.onMessage(message);
  }

  async close() {}
}

const assignment: AgentAssignment = {
  runId: "run-1",
  scopeId: "project-1",
  cwd: "/tmp/product-1",
  systemPrompt: "只分析产品",
  prompt: "分析这份 PRD",
  model: "account-default",
  thinkingLevel: "low"
};

const bindings = (): CodexBindingStore & {
  threads: Map<string, string>;
  turns: Map<string, string>;
  deletedThreads: Array<{ scopeId: string; threadId: string }>;
} => {
  const threads = new Map<string, string>();
  const turns = new Map<string, string>();
  const deletedThreads: Array<{ scopeId: string; threadId: string }> = [];
  return {
    threads,
    turns,
    deletedThreads,
    getThreadBinding: (scopeId) => threads.has(scopeId) ? { threadId: threads.get(scopeId)! } : null,
    saveThreadBinding: (scopeId, threadId) => threads.set(scopeId, threadId),
    deleteThreadBinding: (scopeId, expectedThreadId) => {
      if (threads.get(scopeId) !== expectedThreadId) return false;
      deletedThreads.push({ scopeId, threadId: expectedThreadId });
      return threads.delete(scopeId);
    },
    saveTurnBinding: (runId, _threadId, turnId) => turns.set(runId, turnId)
  };
};

describe("CodexAppServerRuntime", () => {
  it("recognizes only explicit App Server missing-thread errors as recoverable", () => {
    expect(isMissingCodexThreadError(
      new CodexRpcError("missing", 404)
    )).toBe(true);
    expect(isMissingCodexThreadError(
      new CodexRpcError("missing", -32000, { code: "THREAD_NOT_FOUND" })
    )).toBe(true);
    expect(isMissingCodexThreadError(
      new CodexRpcError("指定线程不存在", -32000)
    )).toBe(true);
    expect(isMissingCodexThreadError(
      new CodexRpcError("thread deletion denied", -32000, { code: "PERMISSION_DENIED" })
    )).toBe(false);
    expect(isMissingCodexThreadError(
      new CodexRpcError("thread service unavailable", "INTERNAL")
    )).toBe(false);
    expect(isMissingCodexThreadError(new Error("thread not found"))).toBe(false);
  });

  it("maps Codex Thread/Turn notifications to the existing durable runtime events", async () => {
    const transport = new RuntimeTransport();
    const store = bindings();
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      bindings: store,
      turnTimeoutMs: 1_000
    });
    const events = [];

    for await (const event of runtime.run(assignment)) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "agent.started",
      "turn.started",
      "text.delta",
      "agent.completed"
    ]);
    expect(store.threads.get("project-1")).toBe("thread-1");
    expect(store.turns.get("run-1")).toBe("turn-1");
    expect(transport.sent.find((message) => message.method === "thread/start")?.params)
      .toEqual(expect.objectContaining({ sandbox: "read-only", approvalPolicy: "never" }));
  });

  it("reuses one product thread across different production runs with the same scope", async () => {
    const transport = new RuntimeTransport();
    const store = bindings();
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      bindings: store,
      turnTimeoutMs: 1_000
    });

    for await (const _event of runtime.run(assignment)) {
      // Drain the first production run.
    }
    for await (const _event of runtime.run({ ...assignment, runId: "run-2" })) {
      // Drain the next stage while retaining the product scope.
    }

    expect(transport.sent.filter((message) => message.method === "thread/start")).toHaveLength(1);
    expect(transport.sent.filter((message) => message.method === "thread/resume")).toHaveLength(1);
    expect(store.threads.get("project-1")).toBe("thread-1");
    expect([...store.turns.keys()]).toEqual(["run-1", "run-2"]);
  });

  it("clears a stale binding and starts exactly one replacement when resume explicitly returns NOT_FOUND", async () => {
    const transport = new RuntimeTransport(true, "completed", {
      code: -32000,
      message: "thread not found",
      data: { code: "NOT_FOUND" }
    });
    const store = bindings();
    store.threads.set("project-1", "thread-stale");
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      bindings: store,
      turnTimeoutMs: 1_000
    });
    const events = [];

    for await (const event of runtime.run(assignment)) events.push(event);

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "thread/resume",
      "thread/start",
      "turn/start"
    ]);
    expect(store.deletedThreads).toEqual([
      { scopeId: "project-1", threadId: "thread-stale" }
    ]);
    expect(store.threads.get("project-1")).toBe("thread-1");
    expect(transport.sent.filter((message) => message.method === "thread/resume")).toHaveLength(1);
    expect(transport.sent.filter((message) => message.method === "thread/start")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("agent.completed");
  });

  it("does not clear or replace a binding for non-NOT_FOUND resume errors", async () => {
    const transport = new RuntimeTransport(true, "completed", {
      code: -32000,
      message: "thread resume is forbidden",
      data: { code: "PERMISSION_DENIED" }
    });
    const store = bindings();
    store.threads.set("project-1", "thread-protected");
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      bindings: store,
      turnTimeoutMs: 1_000
    });
    const events = [];

    for await (const event of runtime.run(assignment)) events.push(event);

    expect(store.deletedThreads).toEqual([]);
    expect(store.threads.get("project-1")).toBe("thread-protected");
    expect(transport.sent.some((message) => message.method === "thread/start")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "codex_app_server_error" })
      })
    ]);
  });

  it("blocks model execution until a ChatGPT account is logged in", async () => {
    const transport = new RuntimeTransport(false);
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      turnTimeoutMs: 1_000
    });
    const events = [];
    for await (const event of runtime.run(assignment)) events.push(event);

    expect(events).toEqual([
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "openai_auth_required" })
      })
    ]);
    expect(transport.sent.some((message) => message.method === "turn/start")).toBe(false);
  });

  it("fails promptly when App Server disconnects during a turn", async () => {
    const transport = new RuntimeTransport(true, "closed");
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      turnTimeoutMs: 10_000
    });
    const events = [];

    for await (const event of runtime.run(assignment)) events.push(event);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "codex_connection_closed" })
      })
    ]));
  });

  it("interrupts the upstream turn after the local timeout", async () => {
    const transport = new RuntimeTransport(true, "hanging");
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      turnTimeoutMs: 10
    });
    const events = [];

    for await (const event of runtime.run(assignment)) events.push(event);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "codex_turn_timeout" })
      })
    ]));
    expect(transport.sent).toContainEqual(expect.objectContaining({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" }
    }));
  });

  it("routes a dynamic tool only to its exact turn and preserves a denied result", async () => {
    const transport = new RuntimeTransport(true, "completed", null, {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "workspace_read",
      arguments: { path: "README.md" }
    });
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      turnTimeoutMs: 1_000
    });
    const calls: Array<{ callId: string; args: Record<string, unknown> }> = [];
    const events = [];

    for await (const event of runtime.runWithTools(assignment, [{
      name: "workspace_read",
      canonicalName: "workspace.read",
      description: "读取文件",
      inputSchema: { type: "object" },
      execute: async (callId, args) => {
        calls.push({ callId, args });
        return {
          toolCallId: callId,
          toolName: "workspace.read",
          status: "denied",
          summary: "路径越界",
          artifactIds: [],
          evidenceIds: [],
          startedAt: "2026-09-02T08:00:00.000Z",
          completedAt: "2026-09-02T08:00:00.001Z"
        };
      }
    }])) events.push(event);

    expect(calls).toEqual([{ callId: "call-1", args: { path: "README.md" } }]);
    expect(transport.sent).toContainEqual({
      id: "server-tool-1",
      result: {
        contentItems: [{
          type: "inputText",
          text: expect.stringContaining('\"status\":\"denied\"')
        }],
        success: false
      }
    });
    expect(events.at(-1)?.type).toBe("agent.completed");
  });

  it("rejects a stale dynamic tool request from another turn without executing it", async () => {
    const transport = new RuntimeTransport(true, "completed", null, {
      threadId: "thread-1",
      turnId: "turn-stale",
      callId: "call-stale",
      tool: "workspace_read",
      arguments: { path: "README.md" }
    });
    const runtime = new CodexAppServerRuntime({
      client: new CodexAppServerClient({ transportFactory: () => transport }),
      turnTimeoutMs: 1_000
    });
    let executed = false;

    for await (const _event of runtime.runWithTools(assignment, [{
      name: "workspace_read",
      canonicalName: "workspace.read",
      description: "读取文件",
      inputSchema: { type: "object" },
      execute: async () => {
        executed = true;
        throw new Error("不应执行");
      }
    }])) {
      // Drain until the fake transport closes the turn after the RPC rejection.
    }

    expect(executed).toBe(false);
    expect(transport.sent).toContainEqual({
      id: "server-tool-1",
      error: { code: -32601, message: "未注册服务端请求处理器：item/tool/call" }
    });
  });

  it("uses a completed agent message when no delta was emitted", () => {
    const mapper = createCodexNotificationMapper();
    expect(mapper({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "message-1", text: "完整最终结果" }
      }
    })).toEqual([
      expect.objectContaining({ type: "text.delta", payload: { delta: "完整最终结果" } })
    ]);
  });

  it("keeps imageGeneration completion as an unverified tool result until the worker checks the file", () => {
    const mapper = createCodexNotificationMapper();
    const events = mapper({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "imageGeneration",
          id: "image-1",
          status: "completed",
          revisedPrompt: null,
          result: "opaque-result",
          failure: null,
          savedPath: "/tmp/image-1.png"
        }
      }
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({
          sourceItemType: "imageGeneration",
          lifecycle: "item/completed",
          generationSucceeded: true,
          savedPath: "/tmp/image-1.png"
        })
      })
    ]);
    expect(events.some((event) => event.type === "artifact.available")).toBe(false);
  });

  it("does not promote a textual imageGeneration completion without a saved path", () => {
    const mapper = createCodexNotificationMapper();
    expect(mapper({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "imageGeneration",
          id: "image-1",
          status: "completed",
          revisedPrompt: null,
          result: "the model says the image is done",
          failure: null
        }
      }
    })).toEqual([
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({
          generationSucceeded: true,
          savedPath: null
        })
      })
    ]);
  });

  it("keeps deterministic in-memory scripts for offline workflow tests", async () => {
    const runtime = new InMemoryAgentRuntime([
      { type: "agent.started", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" },
      { type: "agent.completed", payload: {}, occurredAt: "2026-01-01T00:00:01.000Z" }
    ]);
    const types = [];
    for await (const event of runtime.run(assignment)) types.push(event.type);
    expect(types).toEqual(["agent.started", "agent.completed"]);
  });
});
