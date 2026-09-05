import { afterEach, describe, expect, it, vi } from "vitest";
import { startRunControlBridge } from "./run-control";

afterEach(() => vi.useRealTimers());
const commands = [
  { sequence: 1, type: "harness.command.steer", payload: { message: "修改" } },
  { sequence: 2, type: "harness.command.abort", payload: { reason: "停止" } }
];

describe("durable run controls", () => {
  it("delivers abort ahead of rejected feedback and records the permanent refusal once", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn(async (type: string) => ({ accepted: type.endsWith("abort"), message: "回执" }));
    const receipt = vi.fn();
    const stop = startRunControlBridge({ read: (cursor) => commands.filter((event) => event.sequence > cursor), receipt, dispatch });
    await vi.advanceTimersByTimeAsync(1_600);
    await stop();
    expect(dispatch.mock.calls.map(([type]) => type)).toEqual(["harness.command.abort", "harness.command.steer"]);
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ commandSequence: 1, accepted: false }));
  });

  it("retries a starting turn without losing a later abort, then expires pending feedback", async () => {
    vi.useFakeTimers();
    const available = [commands[0]!];
    const receipt = vi.fn();
    const dispatch = vi.fn(async (type: string) => ({ accepted: type.endsWith("abort"), message: "尚未开始", retryWhenInactive: true }));
    const stop = startRunControlBridge({ read: (cursor) => available.filter((event) => event.sequence > cursor), receipt, dispatch, startupGraceMs: 800 });
    await vi.advanceTimersByTimeAsync(400);
    available.push(commands[1]!);
    await vi.advanceTimersByTimeAsync(800);
    await stop();
    expect(dispatch).toHaveBeenCalledWith("harness.command.abort", "停止");
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ commandSequence: 1, accepted: false }));
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ commandSequence: 2, accepted: true }));
  });

  it("does not replay commands already acknowledged before a worker restart", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const history = [...commands, { sequence: 3, type: "harness.command.receipt", payload: { commandSequence: 1 } }, { sequence: 4, type: "harness.command.receipt", payload: { commandSequence: 2 } }];
    const stop = startRunControlBridge({ read: (cursor) => history.filter((event) => event.sequence > cursor), receipt: vi.fn(), dispatch });
    await vi.advanceTimersByTimeAsync(800);
    await stop();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
