type CommandType = "harness.command.steer" | "harness.command.abort";
type ControlEvent = { sequence: number; type: string; payload: Record<string, unknown> };
type ControlResult = { accepted: boolean; message: string; retryWhenInactive?: boolean };

/** Separate the read cursor from undelivered commands so one inactive/unsupported
 * steer never prevents the stop behind it from being delivered. */
export function startRunControlBridge(options: {
  read: (cursor: number) => ControlEvent[];
  receipt: (payload: Record<string, unknown>) => void;
  dispatch: (type: CommandType, value: string) => Promise<ControlResult>;
  startupGraceMs?: number;
}) {
  let cursor = 0;
  let closed = false;
  let activeDrain: Promise<void> | null = null;
  const pending = new Map<number, { event: ControlEvent; deadline: number }>();
  const acknowledge = (event: ControlEvent, result: ControlResult) => {
    options.receipt({ commandSequence: event.sequence, commandType: event.type,
      accepted: result.accepted, message: result.message });
    pending.delete(event.sequence);
  };
  const collect = () => {
    for (const event of options.read(cursor)) {
      cursor = Math.max(cursor, event.sequence);
      if (event.type === "harness.command.steer" || event.type === "harness.command.abort") {
        pending.set(event.sequence, { event, deadline: Date.now() + (options.startupGraceMs ?? 30_000) });
      } else if (event.type === "harness.command.receipt") {
        pending.delete(Number(event.payload.commandSequence));
      }
    }
  };
  const drain = async () => {
    collect();
    const ordered = [...pending.values()].sort((a, b) =>
      Number(b.event.type === "harness.command.abort") - Number(a.event.type === "harness.command.abort") ||
      a.event.sequence - b.event.sequence);
    for (const { event, deadline } of ordered) {
      if (closed) break;
      const type = event.type as CommandType;
      const value = String(type === "harness.command.abort" ? event.payload.reason ?? "用户停止" : event.payload.message ?? "");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let result: ControlResult;
      try {
        result = await Promise.race([
          options.dispatch(type, value),
          new Promise<ControlResult>((resolve) => {
            timeout = setTimeout(() => resolve({ accepted: false, message: "运行控制响应超时，请检查状态后重试" }), 5_000);
          })
        ]);
      } catch {
        result = { accepted: false, message: "运行控制指令发送失败，可重试" };
      } finally {
        clearTimeout(timeout);
      }
      if (!result.accepted && result.retryWhenInactive && Date.now() < deadline) continue;
      acknowledge(event, result);
    }
  };
  const tick = () => {
    if (closed || activeDrain) return;
    activeDrain = drain().finally(() => { activeDrain = null; });
  };
  const timer = setInterval(tick, 400);
  tick();
  return async () => {
    closed = true;
    clearInterval(timer);
    await activeDrain;
    collect();
    for (const { event } of pending.values()) {
      acknowledge(event, { accepted: false, message: "本次运行已结束，指令未执行" });
    }
  };
}
