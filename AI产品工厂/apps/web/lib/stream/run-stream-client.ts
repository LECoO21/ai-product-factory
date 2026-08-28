import type { RunEvent } from "@factory/shared";
import { getProductionRun, type RunSnapshot } from "@/features/production-run/api";
import { decideReconnect, parseRunEvent } from "./run-stream";

type RunStreamOptions = {
  runId: string;
  afterSequence: number;
  onEvent: (event: RunEvent) => void;
  onSnapshot: (snapshot: RunSnapshot) => void;
  onConnectionChange: (state: "connected" | "disconnected" | "stale") => void;
};

export function connectRunStream(options: RunStreamOptions) {
  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let closed = false;
  let attempt = 0;
  let lastSequence = options.afterSequence;

  const connect = () => {
    if (closed) return;
    source = new EventSource(
      `/api/runs/${encodeURIComponent(options.runId)}/events?after=${lastSequence}`
    );
    source.onopen = () => {
      attempt = 0;
      options.onConnectionChange("connected");
    };
    source.onmessage = (message) => {
      const event = parseRunEvent(message.data);
      if (!event || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      options.onEvent(event);
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (closed) return;
      options.onConnectionChange("disconnected");
      void getProductionRun(options.runId)
        .then((snapshot) => {
          if (closed) return;
          options.onSnapshot(snapshot);
          const newestSequence = snapshot.events.at(-1)?.sequence ?? lastSequence;
          lastSequence = Math.max(lastSequence, newestSequence);
          const decision = decideReconnect(snapshot.run.status, attempt);
          if (!decision.reconnect) {
            if (["ready", "running"].includes(snapshot.run.status)) {
              options.onConnectionChange("stale");
            }
            return;
          }
          attempt += 1;
          retryTimer = window.setTimeout(connect, decision.delayMs);
        })
        .catch(() => {
          if (closed) return;
          const decision = decideReconnect("running", attempt);
          if (!decision.reconnect) {
            options.onConnectionChange("stale");
            return;
          }
          attempt += 1;
          retryTimer = window.setTimeout(connect, decision.delayMs);
        });
    };
  };

  connect();
  return () => {
    closed = true;
    source?.close();
    if (retryTimer !== null) window.clearTimeout(retryTimer);
  };
}
