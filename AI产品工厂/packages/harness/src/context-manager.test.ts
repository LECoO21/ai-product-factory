import { describe, expect, it } from "vitest";
import { ContextManager } from "./context-manager";
import type { ToolResultEnvelope } from "./tool-gateway";

const envelope = (data?: unknown): ToolResultEnvelope => ({
  toolCallId: "1",
  toolName: "test.run",
  status: "succeeded",
  summary: "ok",
  ...(data === undefined ? {} : { data }),
  artifactIds: [],
  evidenceIds: [],
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString()
});

describe("ContextManager", () => {
  it("小结果原样保留", () => {
    const manager = new ContextManager({ maxToolResultBytes: 100 });
    const result = envelope({ small: "x" });
    expect(manager.trimToolResult(result)).toEqual(result);
  });

  it("大结果被裁剪并标记", () => {
    const manager = new ContextManager({ maxToolResultBytes: 50 });
    const bigData = { text: "a".repeat(1000) };
    const trimmed = manager.trimToolResult(envelope(bigData)) as ToolResultEnvelope & {
      data: Record<string, unknown>;
    };
    expect(trimmed.data.truncated).toBe(true);
    expect(trimmed.data.originalBytes).toBe(JSON.stringify(bigData).length);
    expect(trimmed.data.summary).toBe("ok");
  });

  it("无 data 的结果保持不变", () => {
    const manager = new ContextManager();
    const result = envelope();
    expect(manager.trimToolResult(result)).toEqual(result);
  });
});
