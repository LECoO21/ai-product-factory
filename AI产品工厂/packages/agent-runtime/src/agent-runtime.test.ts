import { describe, expect, it } from "vitest";
import type { AgentAssignment } from "@factory/shared";
import { InMemoryAgentRuntime, PiAgentRuntime } from "./index";

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
});
