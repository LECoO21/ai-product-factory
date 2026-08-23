import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AgentAssignment } from "@factory/shared";
import { createPiEventMapper, InMemoryAgentRuntime, PiAgentRuntime } from "./index";

const assignment: AgentAssignment = {
  runId: "run-1",
  systemPrompt: "Inspect a product PRD.",
  prompt: "Analyse this PRD.",
  model: "deepseek-v4-flash",
  thinkingLevel: "low"
};

describe("AgentRuntime", () => {
  it("reports missing DeepSeek configuration without making a network call", async () => {
    const runtime = new PiAgentRuntime("");
    const events = [];
    for await (const event of runtime.run(assignment)) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({
        type: "agent.failed",
        payload: expect.objectContaining({ code: "deepseek_key_missing" })
      })
    ]);
  });

  it("allows deterministic in-memory event scripts for production tests", async () => {
    const runtime = new InMemoryAgentRuntime([
      { type: "agent.started", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" },
      {
        type: "text.delta",
        payload: { delta: "done" },
        occurredAt: "2026-01-01T00:00:01.000Z"
      },
      { type: "agent.completed", payload: {}, occurredAt: "2026-01-01T00:00:02.000Z" }
    ]);
    const types = [];
    for await (const event of runtime.run(assignment)) types.push(event.type);
    expect(types).toEqual(["agent.started", "text.delta", "agent.completed"]);
  });

  it("recovers final assistant text when the provider emitted no text deltas", () => {
    const mapEvent = createPiEventMapper();
    const events = mapEvent({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "这是最终完整的产品理解结果。" }]
        }
      ]
    } as AgentEvent);

    expect(events).toEqual([
      expect.objectContaining({ type: "text.delta", payload: { delta: "这是最终完整的产品理解结果。" } }),
      expect.objectContaining({ type: "agent.completed", payload: { messageCount: 1 } })
    ]);
  });

  it("does not duplicate final assistant text after streaming deltas", () => {
    const mapEvent = createPiEventMapper();
    const streamed = mapEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "已流式输出" }
    } as AgentEvent);
    const completed = mapEvent({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "已流式输出" }]
        }
      ]
    } as AgentEvent);

    expect(streamed.map((event) => event.type)).toEqual(["text.delta"]);
    expect(completed.map((event) => event.type)).toEqual(["agent.completed"]);
  });
});
