import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RunEvent } from "@factory/shared";

export const FACTORY_PROTOCOL_VERSION = "1.0" as const;

export const factoryProtocolEventTypeSchema = z.enum([
  "thread.configured",
  "turn.started",
  "turn.awaiting_approval",
  "turn.completed",
  "turn.failed",
  "turn.blocked",
  "turn.interrupted",
  "turn.command.received",
  "item.started",
  "item.delta",
  "item.completed",
  "approval.requested",
  "approval.resolved",
  "checkpoint.created"
]);

export const factoryProtocolEventSchema = z.object({
  protocolVersion: z.literal(FACTORY_PROTOCOL_VERSION),
  eventId: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  type: factoryProtocolEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string()
});

export const factoryCommandSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(8),
    type: z.literal("turn.steer"),
    threadId: z.string(),
    turnId: z.string(),
    message: z.string().trim().min(1).max(1000)
  }),
  z.object({
    id: z.string().min(8),
    type: z.literal("turn.interrupt"),
    threadId: z.string(),
    turnId: z.string(),
    reason: z.string().trim().min(1).max(500)
  }),
  z.object({
    id: z.string().min(8),
    type: z.literal("approval.resolve"),
    threadId: z.string(),
    turnId: z.string(),
    approvalId: z.string(),
    decision: z.enum(["approved", "rejected"])
  })
]);

export type FactoryProtocolEventType = z.infer<typeof factoryProtocolEventTypeSchema>;
export type FactoryProtocolEvent = z.infer<typeof factoryProtocolEventSchema>;
export type FactoryCommand = z.infer<typeof factoryCommandSchema>;

export interface ProtocolEventStore {
  append(turnId: string, type: string, payload?: Record<string, unknown>): RunEvent;
  events(turnId: string, afterSequence?: number): RunEvent[];
}

export type ProtocolContext = {
  threadId: string;
  turnId: string;
};

const legacyProtocolType = (type: string): FactoryProtocolEventType => {
  if (type === "text.delta") return "item.delta";
  if (type === "agent.started" || type === "tool.started" || type.endsWith(".started")) {
    return "item.started";
  }
  if (type === "gate.requested") return "approval.requested";
  if (type === "gate.approved") return "approval.resolved";
  if (type === "harness.command.steer" || type === "harness.command.abort") {
    return "turn.command.received";
  }
  return "item.completed";
};

export class ProtocolEventPublisher {
  constructor(
    private readonly store: ProtocolEventStore,
    private readonly context: ProtocolContext
  ) {}

  emit(type: FactoryProtocolEventType, payload: Record<string, unknown> = {}) {
    const event = factoryProtocolEventSchema.parse({
      protocolVersion: FACTORY_PROTOCOL_VERSION,
      eventId: randomUUID(),
      threadId: this.context.threadId,
      turnId: this.context.turnId,
      type,
      payload,
      occurredAt: new Date().toISOString()
    });
    return this.store.append(this.context.turnId, `protocol.${type}`, event);
  }

  /**
   * Keeps the existing WebUI event contract alive while every domain fact also
   * enters the versioned protocol stream. This seam can be removed after all
   * clients consume protocol events directly.
   */
  legacy(type: string, payload: Record<string, unknown> = {}) {
    const legacy = this.store.append(this.context.turnId, type, payload);
    this.emit(legacyProtocolType(type), { legacyType: type, ...payload });
    return legacy;
  }
}

export const createProtocolEventPublisher = (
  store: ProtocolEventStore,
  context: ProtocolContext
) => new ProtocolEventPublisher(store, context);

export const readProtocolEvents = (
  store: ProtocolEventStore,
  turnId: string,
  afterSequence = 0
) => store.events(turnId, afterSequence).flatMap((event) => {
  if (!event.type.startsWith("protocol.")) return [];
  const parsed = factoryProtocolEventSchema.safeParse(event.payload);
  return parsed.success ? [{ sequence: event.sequence, ...parsed.data }] : [];
});

export const legacyCommandType = (command: FactoryCommand) => {
  if (command.type === "turn.steer") return "harness.command.steer" as const;
  if (command.type === "turn.interrupt") return "harness.command.abort" as const;
  return "gate.approved" as const;
};
