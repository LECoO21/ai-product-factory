import type { ProductProject, RunEvent } from "@factory/shared";

type FlowHistory = {
  events: readonly Pick<RunEvent, "type" | "payload">[];
};

const terminalProjectStatuses = new Set<ProductProject["status"]>(["candidate", "released"]);

/**
 * A product flow ends only through an explicit terminal action. A revision may
 * mark an older Run as cancelled, but it has no abort event and must keep using
 * the product's original manual snapshot.
 */
export const shouldCloseProductManualSnapshot = (
  project: Pick<ProductProject, "status"> | null,
  histories: readonly FlowHistory[]
): boolean => {
  if (!project || terminalProjectStatuses.has(project.status)) return true;
  return histories.some(({ events }) => events.some((event) =>
    event.type === "harness.command.abort" ||
    (event.type === "gate.approved" && event.payload.completed === true)
  ));
};
