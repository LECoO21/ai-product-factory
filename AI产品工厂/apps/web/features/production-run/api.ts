import {
  evidenceSchema,
  harnessRunStatusSchema,
  productionRunSchema,
  runEventSchema,
  workPlanItemSchema
} from "@factory/shared";
import { z } from "zod";
import { requestJson } from "@/lib/api/client";

const harnessViewSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: harnessRunStatusSchema,
  stopReason: z.string().nullable(),
  plan: z.array(workPlanItemSchema),
  tools: z.array(z.object({
    toolCallId: z.string(),
    toolName: z.string(),
    permission: z.string(),
    status: z.string(),
    summary: z.string().nullable(),
    startedAt: z.string()
  })),
  artifacts: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    sha256: z.string(),
    size: z.number(),
    status: z.string()
  })),
  evidence: z.array(evidenceSchema)
});

export const runSnapshotSchema = z.object({
  run: productionRunSchema,
  events: z.array(runEventSchema),
  harness: harnessViewSchema.nullable()
});

const runResponseSchema = z.object({ run: productionRunSchema });
const approveResponseSchema = z.object({
  completedRun: productionRunSchema,
  nextRun: productionRunSchema.nullable()
});
const receiptResponseSchema = z.object({
  receipt: z.object({ accepted: z.boolean(), commandSequence: z.number().int().nonnegative() })
});

export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

export function startProductionRun(projectId: string) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/runs`, {
    method: "POST",
    body: JSON.stringify({ objective: "执行 PRD 接单体检并输出产品理解摘要" }),
    schema: runResponseSchema
  });
}

export function getProductionRun(runId: string, signal?: AbortSignal) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    ...(signal ? { signal } : {}),
    schema: runSnapshotSchema
  });
}

export function approveProductionRun(runId: string) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/approve`, {
    method: "POST",
    schema: approveResponseSchema
  });
}

export function retryProductionRun(runId: string) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    schema: runResponseSchema
  });
}

export function steerProductionRun(runId: string, message: string, idempotencyKey: string) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/steer`, {
    method: "POST",
    body: JSON.stringify({ message, idempotencyKey }),
    schema: receiptResponseSchema
  });
}

export function abortProductionRun(runId: string, reason: string, idempotencyKey: string) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/abort`, {
    method: "POST",
    body: JSON.stringify({ reason, idempotencyKey }),
    schema: receiptResponseSchema
  });
}
