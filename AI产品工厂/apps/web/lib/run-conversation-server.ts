import "server-only";
import type { ProductionRunStore } from "@factory/records";
import { getHarnessView } from "./harness-server";
import {
  getEarlierConversationRuns,
  type ConversationRun,
  type ConversationRunRecord
} from "./run-conversation";

export function getConversationHistory(
  store: Pick<ProductionRunStore, "listForProject" | "events">,
  selected: ConversationRunRecord
): ConversationRun[] {
  const records = store.listForProject(selected.run.projectId)
    .filter((run) => run.id !== selected.run.id)
    .map((run) => ({ run, events: store.events(run.id) }));

  return getEarlierConversationRuns(records, selected).map((record) => ({
    ...record,
    harness: getHarnessView(record.run.id)
  }));
}
