import { describe, expect, it } from "vitest";
import { shouldCloseProductManualSnapshot } from "./manual-lifecycle";

const history = (...events: Array<{ type: string; payload?: Record<string, unknown> }>) => ({
  events: events.map((event) => ({ type: event.type, payload: event.payload ?? {} }))
});

describe("shouldCloseProductManualSnapshot", () => {
  it("keeps one snapshot through normal stages, retries and revision supersession", () => {
    expect(shouldCloseProductManualSnapshot(
      { status: "draft" },
      [
        history({ type: "gate.approved", payload: { nextRunId: "adaptation-run" } }),
        history(
          { type: "run.cancelled" },
          { type: "gate.revision_requested", payload: { revisionRunId: "revision-run" } }
        )
      ]
    )).toBe(false);
  });

  it("closes after explicit user termination", () => {
    expect(shouldCloseProductManualSnapshot(
      { status: "draft" },
      [history({ type: "harness.command.abort", payload: { reason: "用户取消" } })]
    )).toBe(true);
  });

  it("closes after any terminal completed gate, including a non-release validation flow", () => {
    expect(shouldCloseProductManualSnapshot(
      { status: "draft" },
      [history({ type: "gate.approved", payload: { completed: true } })]
    )).toBe(true);
  });

  it.each(["candidate", "released"] as const)("closes a %s project even without events", (status) => {
    expect(shouldCloseProductManualSnapshot({ status }, [])).toBe(true);
  });
});
