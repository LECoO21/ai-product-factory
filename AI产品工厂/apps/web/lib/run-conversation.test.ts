import { describe, expect, it } from "vitest";
import {
  getEarlierConversationRuns,
  type ConversationRunRecord
} from "./run-conversation";

const record = (
  id: string,
  sequence: number,
  createdAt = "2026-09-05T00:00:00.000Z",
  projectId = "project-1"
): ConversationRunRecord => ({
  run: {
    id,
    projectId,
    stage: "intake",
    objective: "理解产品",
    status: "waiting_approval",
    workerId: null,
    error: null,
    createdAt,
    updatedAt: createdAt
  },
  events: [{
    id: `event-${sequence}`,
    sequence,
    runId: id,
    type: "run.created",
    payload: {},
    occurredAt: createdAt
  }]
});

describe("getEarlierConversationRuns", () => {
  it("preserves revisions and retries at the same timestamp without including later runs", () => {
    const original = record("z-original", 1);
    const revision = record("y-revision", 10);
    const retry = record("x-retry", 20);
    const current = record("a-current", 30);
    const future = record("b-future", 40);
    const records = [future, retry, original, current, revision];

    original.events.push({
      id: "feedback-event",
      sequence: 12,
      runId: original.run.id,
      type: "gate.revision_requested",
      payload: { feedback: "请保留历史结果", revisionRunId: revision.run.id },
      occurredAt: original.run.createdAt
    });

    expect(getEarlierConversationRuns(records, current)).toEqual([original, revision, retry]);
    expect(records).toEqual([future, retry, original, current, revision]);
  });

  it("isolates the product and includes only the history available before the selected run", () => {
    const earlier = record("earlier", 1, "2026-09-04T00:00:00.000Z");
    const foreign = record("foreign", 2, "2026-09-04T01:00:00.000Z", "project-2");
    const current = record("current", 3);
    const future = record("future", 4, "2026-09-06T00:00:00.000Z");

    expect(getEarlierConversationRuns([future, foreign, earlier], current)).toEqual([earlier]);
    expect(getEarlierConversationRuns([future, foreign, earlier, current], earlier)).toEqual([]);
  });

  it("uses a stable fallback when legacy runs have no events", () => {
    const earlier = record("a-earlier", 1);
    const current = record("b-current", 2);
    const future = record("c-future", 3);
    earlier.events = [];
    current.events = [];
    future.events = [];

    expect(getEarlierConversationRuns([future, earlier], current)).toEqual([earlier]);
  });
});
