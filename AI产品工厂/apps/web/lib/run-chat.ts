import { PRODUCT_PROTOTYPE_END, PRODUCT_PROTOTYPE_START, type RunEvent } from "@factory/shared";

export type ChatEntry =
  | { kind: "output"; key: string; text: string }
  | { kind: "activity"; key: string; events: RunEvent[] }
  | { kind: "user"; key: string; event: RunEvent };

const userEventTypes = new Set([
  "gate.approved", "gate.revision_requested", "harness.command.steer", "harness.command.abort"
]);

/** Public events are the durable transcript; protocol events mirror them. */
export function buildChatEntries(events: readonly RunEvent[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  // Strip embedded HTML across delta boundaries, including a currently streaming block.
  let pendingText = "";
  let inPrototype = false;
  const visibleDelta = (delta: string, flush = false) => {
    pendingText += delta;
    let visible = "";
    while (pendingText) {
      const marker = inPrototype ? PRODUCT_PROTOTYPE_END : PRODUCT_PROTOTYPE_START;
      const index = pendingText.indexOf(marker);
      if (index >= 0) {
        if (!inPrototype) visible += pendingText.slice(0, index);
        pendingText = pendingText.slice(index + marker.length);
        inPrototype = !inPrototype;
      } else {
        let held = 0;
        if (!flush) {
          for (let length = 1; length < marker.length && length <= pendingText.length; length++) {
            if (pendingText.endsWith(marker.slice(0, length))) held = length;
          }
        }
        if (!inPrototype) visible += pendingText.slice(0, pendingText.length - held);
        pendingText = held ? pendingText.slice(-held) : "";
        break;
      }
    }
    return visible;
  };
  for (const event of events) {
    if (event.type.startsWith("protocol.")) continue;
    const previous = entries.at(-1);
    if (/^(agent\.(completed|failed)|run\.(succeeded|failed|cancelled|waiting_approval))$/.test(event.type)) {
      const tail = visibleDelta("", true);
      if (tail) {
        if (previous?.kind === "output") previous.text += tail;
        else entries.push({ kind: "output", key: `${event.id}-tail`, text: tail });
      }
    }
    if (event.type === "text.delta") {
      const text = visibleDelta(typeof event.payload.delta === "string" ? event.payload.delta : "");
      if (!text) continue;
      if (previous?.kind === "output") previous.text += text;
      else entries.push({ kind: "output", key: event.id, text });
    } else if (userEventTypes.has(event.type)) {
      entries.push({ kind: "user", key: event.id, event });
    } else if (entries.at(-1)?.kind === "activity") {
      const activity = entries.at(-1);
      if (activity?.kind === "activity") activity.events.push(event);
    } else {
      entries.push({ kind: "activity", key: event.id, events: [event] });
    }
  }
  return entries;
}
