import { z } from "zod";

export const harnessRunStatusSchema = z.enum([
  "ready",
  "running",
  "verifying",
  "blocked",
  "waiting_user",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted"
]);

export const factoryTaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "interrupted"
]);

export const workPlanItemStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const permissionLevelSchema = z.enum(["P0", "P1", "P2", "P3"]);
export const permissionDecisionSchema = z.enum(["allowed", "approval_required", "denied"]);
export const toolInvocationStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "approval_required",
  "denied"
]);

export const factoryTaskSchema = z.object({
  id: z.string(),
  runId: z.string(),
  objective: z.string().min(1),
  status: factoryTaskStatusSchema,
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  workerId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const harnessRunSchema = z.object({
  id: z.string(),
  productionRunId: z.string(),
  taskId: z.string(),
  sessionPath: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  status: harnessRunStatusSchema,
  stopReason: z.string().nullable(),
  toolCalls: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const workPlanItemSchema = z.object({
  id: z.string(),
  harnessRunId: z.string(),
  position: z.number().int().nonnegative(),
  text: z.string().min(1),
  status: workPlanItemStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const toolInvocationSchema = z.object({
  id: z.string(),
  harnessRunId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  permission: permissionLevelSchema,
  status: toolInvocationStatusSchema,
  result: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable()
});

export const artifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.string(),
  path: z.string(),
  sha256: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  status: z.enum(["ready", "missing", "invalid"]),
  sourceToolCallId: z.string().nullable(),
  createdAt: z.string()
});

export const evidenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  criterionId: z.string(),
  kind: z.string(),
  artifactId: z.string().nullable(),
  observation: z.record(z.string(), z.unknown()),
  passed: z.boolean(),
  createdAt: z.string()
});

export const backgroundJobSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: z.string(),
  pid: z.number().int().nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]),
  commandSummary: z.string(),
  exitCode: z.number().int().nullable(),
  stdoutPath: z.string().nullable(),
  stderrPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type HarnessRunStatus = z.infer<typeof harnessRunStatusSchema>;
export type FactoryTaskStatus = z.infer<typeof factoryTaskStatusSchema>;
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type ToolInvocationStatus = z.infer<typeof toolInvocationStatusSchema>;
export type FactoryTask = z.infer<typeof factoryTaskSchema>;
export type HarnessRun = z.infer<typeof harnessRunSchema>;
export type WorkPlanItem = z.infer<typeof workPlanItemSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;
