import { describe, expect, it } from "vitest";
import type { ProductProject, ProductionRun, RunEvent } from "@factory/shared";
import { FactoryRuntimeCore, RuntimeCommandGateway, type RuntimeTurnStore } from "./index";

const project = { id: "project-1" } as ProductProject;

class MemoryTurnStore implements RuntimeTurnStore {
  readonly items: RunEvent[] = [];
  run: ProductionRun = {
    id: "run-1",
    projectId: "project-1",
    stage: "intake",
    objective: "理解产品",
    status: "running",
    workerId: "worker-1",
    error: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z"
  };

  append(runId: string, type: string, payload: Record<string, unknown> = {}) {
    const event: RunEvent = {
      sequence: this.items.length + 1,
      id: `event-${this.items.length + 1}`,
      runId,
      type,
      payload,
      occurredAt: "2026-08-27T00:00:00.000Z"
    };
    this.items.push(event);
    return event;
  }

  events(runId: string, afterSequence = 0) {
    return this.items.filter((event) => event.runId === runId && event.sequence > afterSequence);
  }

  get(id: string) {
    return id === this.run.id ? this.run : null;
  }

  transition(id: string, status: ProductionRun["status"], error: string | null = null) {
    if (id !== this.run.id) throw new Error("missing");
    this.run = { ...this.run, status, error };
    this.append(id, `run.${status}`, error ? { error } : {});
    return this.run;
  }
}

describe("FactoryRuntimeCore", () => {
  it("owns completion and refuses approval without a real result", async () => {
    const store = new MemoryTurnStore();
    const core = new FactoryRuntimeCore(store, [{
      id: "empty",
      supports: () => true,
      execute: async () => ({ kind: "awaiting_approval", approvalId: "approval-1", gate: "scope" })
    }]);

    await core.execute(store.run, project);

    expect(store.run.status).toBe("failed");
    expect(store.items.map((event) => event.type)).toContain("protocol.turn.failed");
    expect(store.items.map((event) => event.type)).not.toContain("gate.requested");
  });

  it("moves a result-bearing turn to the approval boundary", async () => {
    const store = new MemoryTurnStore();
    const core = new FactoryRuntimeCore(store, [{
      id: "intake",
      supports: () => true,
      execute: async ({ events }) => {
        events.legacy("text.delta", { delta: "这是一份完整且可供产品负责人确认的产品理解结果。" });
        events.legacy("agent.completed", { deterministic: true });
        return { kind: "awaiting_approval", approvalId: "approval-1", gate: "product_scope" };
      }
    }]);

    await core.execute(store.run, project);

    expect(store.run.status).toBe("waiting_approval");
    expect(store.items.map((event) => event.type)).toContain("protocol.turn.awaiting_approval");
    expect(store.items.map((event) => event.type)).toContain("gate.requested");
  });
});

describe("RuntimeCommandGateway", () => {
  it("deduplicates steering commands at the protocol boundary", () => {
    const store = new MemoryTurnStore();
    const gateway = new RuntimeCommandGateway(store);
    const command = {
      id: "command-123",
      type: "turn.steer" as const,
      threadId: "project-1",
      turnId: "run-1",
      message: "先修复测试"
    };

    const first = gateway.submit(command);
    const second = gateway.submit(command);

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, commandSequence: first.commandSequence });
    expect(store.items.filter((event) => event.type === "harness.command.steer")).toHaveLength(1);
  });
});
