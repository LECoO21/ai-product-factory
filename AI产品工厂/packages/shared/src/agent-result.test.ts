import { describe, expect, it } from "vitest";
import { hasConfirmableAgentResult } from "./index";

describe("hasConfirmableAgentResult", () => {
  it("rejects an Agent completion that contains no visible result", () => {
    expect(
      hasConfirmableAgentResult([
        { type: "agent.started", payload: {} },
        { type: "agent.completed", payload: { messageCount: 2 } }
      ])
    ).toBe(false);
  });

  it("accepts a completed Agent result with substantive text", () => {
    expect(
      hasConfirmableAgentResult([
        { type: "text.delta", payload: { delta: "这是可供产品负责人确认的完整产品理解结果。" } },
        { type: "agent.completed", payload: { messageCount: 2 } }
      ])
    ).toBe(true);
  });
});
