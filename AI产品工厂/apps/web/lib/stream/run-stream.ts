import { runEventSchema, type ProductionRun, type RunEvent } from "@factory/shared";

const terminalStatuses = new Set<ProductionRun["status"]>([
  "waiting_approval",
  "blocked",
  "succeeded",
  "failed",
  "cancelled"
]);

export function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]) {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function parseRunEvent(data: string): RunEvent | null {
  try {
    const parsed = runEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function decideReconnect(status: string, attempt: number) {
  if (terminalStatuses.has(status as ProductionRun["status"]) || !["ready", "running"].includes(status)) {
    return { reconnect: false as const, delayMs: null };
  }
  if (attempt >= 5) return { reconnect: false as const, delayMs: null };
  return {
    reconnect: true as const,
    delayMs: Math.min(1_000 * 2 ** attempt, 8_000)
  };
}
