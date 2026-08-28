import { describe, expect, it } from "vitest";
import type { RunEvent } from "@factory/shared";
import {
  createProtocolEventPublisher,
  factoryCommandSchema,
  readProtocolEvents,
  type ProtocolEventStore
} from "./index";

class MemoryStore implements ProtocolEventStore {
  readonly items: RunEvent[] = [];

  append(runId: string, type: string, payload: Record<string, unknown> = {}) {
    const event: RunEvent = {
      sequence: this.items.length + 1,
      id: `event-${this.items.length + 1}`,
      runId,
      type,
      payload,
      occurredAt: "2026-08-27T00:00:00.000Z"
    };
    this.items.push(event);
    return event;
  }

  events(runId: string, afterSequence = 0) {
    return this.items.filter((event) => event.runId === runId && event.sequence > afterSequence);
  }
}

describe("factory protocol", () => {
  it("writes versioned events with thread and turn identity", () => {
    const store = new MemoryStore();
    const events = createProtocolEventPublisher(store, { threadId: "project-1", turnId: "run-1" });

    events.emit("turn.started", { stage: "intake" });

    expect(readProtocolEvents(store, "run-1")).toEqual([
      expect.objectContaining({
        sequence: 1,
        protocolVersion: "1.0",
        threadId: "project-1",
        turnId: "run-1",
        type: "turn.started",
        payload: { stage: "intake" }
      })
    ]);
  });

  it("dual-writes legacy UI facts during migration", () => {
    const store = new MemoryStore();
    const events = createProtocolEventPublisher(store, { threadId: "project-1", turnId: "run-1" });

    events.legacy("text.delta", { delta: "可确认结果" });

    expect(store.items.map((event) => event.type)).toEqual(["text.delta", "protocol.item.delta"]);
  });

  it("rejects commands whose thread and turn identity is missing", () => {
    expect(factoryCommandSchema.safeParse({ id: "12345678", type: "turn.steer", message: "继续" }).success)
      .toBe(false);
  });
});
