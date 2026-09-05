import type { ProductionRun, RunEvent } from "@factory/shared";
import type { HarnessView } from "./harness-types";

export type ConversationRun = {
  run: ProductionRun;
  events: RunEvent[];
  harness: HarnessView | null;
};

export type ConversationRunRecord = Pick<ConversationRun, "run" | "events">;

const firstEventSequence = ({ events }: ConversationRunRecord): number =>
  events.reduce((first, event) => Math.min(first, event.sequence), Number.MAX_SAFE_INTEGER);

export function getEarlierConversationRuns(
  records: readonly ConversationRunRecord[],
  selected: ConversationRunRecord
): ConversationRunRecord[] {
  const ordered = [
    ...records.filter(({ run }) => run.projectId === selected.run.projectId && run.id !== selected.run.id),
    selected
  ].sort((left, right) =>
    left.run.createdAt.localeCompare(right.run.createdAt)
      // Event sequences are global, so equal timestamps still preserve revision/retry order.
      || firstEventSequence(left) - firstEventSequence(right)
      || left.run.id.localeCompare(right.run.id)
  );

  return ordered.slice(0, ordered.findIndex(({ run }) => run.id === selected.run.id));
}
