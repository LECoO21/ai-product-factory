import { describe, expect, it } from "vitest";
import type { ToolGateway } from "@factory/harness";
import {
  createPiTools,
  PiAgentHarnessDriver,
  toDurableAgentMessage,
  type PiAgentPort,
  type PiAgentStateSnapshot
} from "./pi-harness-adapter";

const assistant = (text: string, stopReason: "stop" | "error" | "aborted" = "stop") => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
  stopReason,
  ...(stopReason === "error" ? { errorMessage: text } : {})
});

const agentPort = (finalState: PiAgentStateSnapshot): PiAgentPort => {
  let state: PiAgentStateSnapshot = { messages: [], isStreaming: false };
  return {
    get state() { return state; },
    prompt: async () => { state = finalState; },
    steer: () => undefined,
    abort: () => undefined
  };
};

describe("PiAgentHarnessDriver", () => {
  it("removes undefined values before durable session persistence", () => {
    const message = {
      role: "toolResult" as const,
      toolCallId: "call",
      toolName: "manual_verify",
      content: [{ type: "text" as const, text: "ok" }],
      details: { status: "succeeded", omitted: undefined },
      usage: undefined,
      isError: false,
      timestamp: 1
    };

    expect(toDurableAgentMessage(message)).toEqual({
      role: "toolResult",
      toolCallId: "call",
      toolName: "manual_verify",
      content: [{ type: "text", text: "ok" }],
      details: { status: "succeeded" },
      isError: false,
      timestamp: 1
    });
  });

  it("exposes DeepSeek-compatible tool names and maps them back to canonical names", async () => {
    const calls: Array<{ toolName: string; toolCallId: string }> = [];
    const gateway = {
      execute: async (input: { toolName: string; toolCallId: string }) => {
        calls.push({ toolName: input.toolName, toolCallId: input.toolCallId });
        return {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          status: "succeeded" as const,
          summary: "ok",
          artifactIds: [],
          evidenceIds: [],
          startedAt: "2026-08-25T00:00:00.000Z",
          completedAt: "2026-08-25T00:00:00.001Z"
        };
      }
    } as unknown as ToolGateway;
    const [tool] = createPiTools(gateway, "run", ["manual.verify"]);

    expect(tool?.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    await tool?.execute("call", { authorityVersion: "2026-08-25" });
    expect(calls).toEqual([{ toolName: "manual.verify", toolCallId: "call" }]);
  });

  it("describes evidence fields explicitly so the model can produce valid arguments", () => {
    const gateway = { execute: async () => { throw new Error("unused"); } } as unknown as ToolGateway;
    const [tool] = createPiTools(gateway, "run", ["evidence.register"]);
    const schema = tool?.parameters as unknown as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(schema.required).toEqual(expect.arrayContaining([
      "criterionId", "kind", "observation", "passed"
    ]));
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining([
      "criterionId", "kind", "artifactId", "observation", "passed"
    ]));
  });

  it("uses Pi Agent completion state instead of the unimplemented AgentHarness prompt", async () => {
    const driver = new PiAgentHarnessDriver(agentPort({
      messages: [assistant("真实工具循环完成")],
      isStreaming: false
    }));

    await expect(driver.run({
      prompt: "run",
      execute: async () => { throw new Error("unused"); }
    })).resolves.toEqual({ kind: "completed", summary: "真实工具循环完成" });
  });

  it("maps Pi Agent error and abort terminal states", async () => {
    const failed = new PiAgentHarnessDriver(agentPort({
      messages: [assistant("模型调用失败", "error")],
      isStreaming: false,
      errorMessage: "模型调用失败"
    }));
    const aborted = new PiAgentHarnessDriver(agentPort({
      messages: [assistant("", "aborted")],
      isStreaming: false,
      errorMessage: "This operation was aborted"
    }));

    expect((await failed.run({ prompt: "run", execute: async () => { throw new Error("unused"); } })).kind)
      .toBe("failed");
    expect((await aborted.run({ prompt: "run", execute: async () => { throw new Error("unused"); } })).kind)
      .toBe("aborted");
  });

  it("forwards steer and abort to the active Pi Agent", async () => {
    const steered: string[] = [];
    let aborted = false;
    const port: PiAgentPort = {
      state: { messages: [], isStreaming: true },
      prompt: async () => undefined,
      steer: (message) => { steered.push(message); },
      abort: () => { aborted = true; }
    };
    const driver = new PiAgentHarnessDriver(port);

    expect((await driver.steer("调整方向")).accepted).toBe(true);
    expect((await driver.abort("停止")).accepted).toBe(true);
    expect(steered).toEqual(["调整方向"]);
    expect(aborted).toBe(true);
  });
});
