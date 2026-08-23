import { z } from "zod";

export const capabilityPackSchema = z.enum([
  "web-interface",
  "agent-runtime",
  "long-running-task",
  "rag",
  "multimedia",
  "game-experience",
  "accounts-and-tenancy",
  "high-risk-actions",
  "realtime-communication"
]);

export type CapabilityPack = z.infer<typeof capabilityPackSchema>;

export const productProfileSchema = z.object({
  userTasks: z.array(z.string()),
  interactionModes: z.array(z.string()),
  targetSurfaces: z.array(z.string()),
  executionTraits: z.array(z.string()),
  artifactKinds: z.array(z.string()),
  dataTraits: z.array(z.string()),
  aiRole: z.enum(["development-only", "core", "supporting", "none", "unknown"]),
  riskTraits: z.array(z.string()),
  qualityModes: z.array(z.string()),
  deploymentTargets: z.array(z.string()),
  evidence: z.array(
    z.object({
      dimension: z.string(),
      signal: z.string(),
      conclusion: z.string()
    })
  )
});

export type ProductProfile = z.infer<typeof productProfileSchema>;

export const blueprintStageSchema = z.object({
  id: z.string(),
  title: z.string(),
  purpose: z.string(),
  requiredChecks: z.array(z.string()),
  optional: z.boolean().default(false)
});

export type BlueprintStage = z.infer<typeof blueprintStageSchema>;

export const productionBlueprintSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  capabilityPacks: z.array(capabilityPackSchema),
  stages: z.array(blueprintStageSchema),
  assumptions: z.array(z.string()),
  unsupportedCapabilities: z.array(z.string()),
  generatedAt: z.string()
});

export type ProductionBlueprint = z.infer<typeof productionBlueprintSchema>;

export const projectCreateInputSchema = z.object({
  name: z.string().trim().min(2, "项目名称至少需要 2 个字符").max(80),
  description: z.string().trim().max(500).default(""),
  prd: z.string().trim().min(20, "请提供更完整的 PRD 或产品说明"),
  workspacePath: z.string().trim().nullable().default(null)
});

export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;

export const productProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  prd: z.string(),
  workspacePath: z.string().nullable(),
  status: z.enum(["draft", "ready", "running", "blocked", "candidate", "released"]),
  profile: productProfileSchema,
  blueprint: productionBlueprintSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ProductProject = z.infer<typeof productProjectSchema>;

export type ProjectSummary = Pick<
  ProductProject,
  "id" | "name" | "description" | "status" | "profile" | "blueprint" | "createdAt" | "updatedAt"
>;

export const productionEventSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string()
});

export type ProductionEvent = z.infer<typeof productionEventSchema>;

export const productionStageSchema = z.enum([
  "intake",
  "adaptation",
  "stage-design",
  "implementation",
  "automated-quality",
  "real-acceptance",
  "release-preparation"
]);

export type ProductionStage = z.infer<typeof productionStageSchema>;

export const productionRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  stage: productionStageSchema,
  objective: z.string(),
  status: z.enum([
    "ready",
    "running",
    "waiting_approval",
    "blocked",
    "succeeded",
    "failed",
    "cancelled"
  ]),
  workerId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ProductionRun = z.infer<typeof productionRunSchema>;

export const runEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  id: z.string(),
  runId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string()
});

export type RunEvent = z.infer<typeof runEventSchema>;

export type AgentResultEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export const MIN_CONFIRMABLE_AGENT_RESULT_CHARACTERS = 20;

export const hasConfirmableAgentResult = (events: AgentResultEvent[]) => {
  if (!events.some((event) => event.type === "agent.completed")) return false;
  if (events.some((event) => event.type === "agent.failed")) return false;
  const result = events
    .filter((event) => event.type === "text.delta")
    .map((event) => String(event.payload.delta ?? ""))
    .join("")
    .replace(/\s/g, "");
  return result.length >= MIN_CONFIRMABLE_AGENT_RESULT_CHARACTERS;
};

export type AgentAssignment = {
  runId: string;
  systemPrompt: string;
  prompt: string;
  model: string;
  thinkingLevel: "off" | "low" | "high";
};

export type AgentRuntimeEvent = {
  type:
    | "agent.started"
    | "turn.started"
    | "text.delta"
    | "tool.started"
    | "tool.completed"
    | "agent.completed"
    | "agent.failed";
  payload: Record<string, unknown>;
  occurredAt: string;
};
