import { describe, expect, it } from "vitest";
import { decideReconnect, mergeRunEvents, parseRunEvent } from "./run-stream";
import type { RunEvent } from "@factory/shared";

const event = (sequence: number): RunEvent => ({
  sequence,
  id: `event-${sequence}`,
  runId: "run-1",
  type: "tool.completed",
  payload: {},
  occurredAt: "2026-08-26T00:00:00.000Z"
});

describe("mergeRunEvents", () => {
  it("deduplicates by sequence and keeps chronological order", () => {
    expect(mergeRunEvents([event(1), event(2)], [event(2), event(4), event(3)]).map((item) => item.sequence))
      .toEqual([1, 2, 3, 4]);
  });
});

describe("parseRunEvent", () => {
  it("ignores malformed or contract-breaking stream data instead of crashing the page", () => {
    expect(parseRunEvent("not-json")).toBeNull();
    expect(parseRunEvent(JSON.stringify({ sequence: "wrong" }))).toBeNull();
    expect(parseRunEvent(JSON.stringify(event(3)))?.sequence).toBe(3);
  });
});

describe("decideReconnect", () => {
  it("stops for terminal backend facts", () => {
    expect(decideReconnect("succeeded", 0)).toEqual({ reconnect: false, delayMs: null });
    expect(decideReconnect("waiting_approval", 0)).toEqual({ reconnect: false, delayMs: null });
  });

  it("uses finite backoff for active tasks", () => {
    expect(decideReconnect("running", 0)).toEqual({ reconnect: true, delayMs: 1_000 });
    expect(decideReconnect("ready", 2)).toEqual({ reconnect: true, delayMs: 4_000 });
    expect(decideReconnect("running", 5)).toEqual({ reconnect: false, delayMs: null });
  });

  it("does not reconnect when the refreshed status is unknown", () => {
    expect(decideReconnect("unknown", 0)).toEqual({ reconnect: false, delayMs: null });
  });
});
