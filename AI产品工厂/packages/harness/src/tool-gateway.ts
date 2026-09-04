import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { SqliteHarnessRecordStore } from "@factory/records";
import type { PermissionLevel, ToolInvocationStatus } from "@factory/shared";

export type ToolResultEnvelope = {
  toolCallId: string;
  toolName: string;
  status: Exclude<ToolInvocationStatus, "started">;
  summary: string;
  data?: unknown;
  artifactIds: string[];
  evidenceIds: string[];
  startedAt: string;
  completedAt: string;
};

export type HarnessToolExecution = {
  summary: string;
  data?: unknown;
  artifactIds?: string[];
  evidenceIds?: string[];
};

export type HarnessToolDefinition = {
  name: string;
  permission: Extract<PermissionLevel, "P0" | "P1">;
  schema: z.ZodType;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<HarnessToolExecution>;
};

export type ToolGateContext = {
  harnessRunId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  permission: PermissionLevel;
  definition: HarnessToolDefinition | undefined;
};

export type PreToolUseResult =
  | { allow: true }
  | { allow: false; status: Exclude<ToolInvocationStatus, "started">; summary: string; data?: unknown };

export type PreToolUseHook = (context: ToolGateContext) => PreToolUseResult | Promise<PreToolUseResult>;

export type PostToolUseHook = (
  context: ToolGateContext & { status: Exclude<ToolInvocationStatus, "started">; summary: string; data?: unknown }
) => void | Promise<void>;

export type ToolGatewayOptions = {
  records: SqliteHarnessRecordStore;
  workspaceRoot: string;
  p1Approved: boolean;
};

const p2Names = new Set([
  "file.delete",
  "dependency.install",
  "git.commit",
  "git.push",
  "external.send",
  "billing.purchase",
  "release.deploy"
]);
const secretNames = new Set([".env", ".env.local", ".env.production"]);
const manualNames = new Set([
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
]);

const isInside = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`);

const redactArgs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactArgs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    /(key|token|secret|password|credential)/i.test(key) ? "[REDACTED]" : redactArgs(nested)
  ]));
};

const argsFingerprint = (args: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(args)).digest("hex");

const pathValues = (args: Record<string, unknown>) =>
  Object.entries(args).flatMap(([key, value]) => {
    if (!/(^path$|paths$|cwd$)/i.test(key)) return [];
    if (typeof value === "string") return [value];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  });

export class ToolGateway {
  private readonly tools = new Map<string, HarnessToolDefinition>();
  private readonly canonicalRoot: string;
  private readonly preHooks: PreToolUseHook[] = [];
  private readonly postHooks: PostToolUseHook[] = [];

  constructor(private readonly options: ToolGatewayOptions) {
    this.canonicalRoot = realpathSync(options.workspaceRoot);
    this.preHooks.push(
      (context) => this.permissionGate(context),
      (context) => this.pathSafetyGate(context)
    );
  }

  register(definition: HarnessToolDefinition) {
    if (this.tools.has(definition.name)) throw new Error(`工具重复注册：${definition.name}`);
    this.tools.set(definition.name, definition);
  }

  addPreHook(hook: PreToolUseHook) {
    this.preHooks.push(hook);
  }

  addPostHook(hook: PostToolUseHook) {
    this.postHooks.push(hook);
  }

  private permissionGate(context: ToolGateContext): PreToolUseResult {
    const { permission } = context;
    if (permission === "P3") {
      return { allow: false, status: "denied", summary: "该动作超出永久安全边界，未执行" };
    }
    if (permission === "P2") {
      const fingerprint = argsFingerprint(context.args);
      const prior = this.options.records.getApprovalDecision(context.harnessRunId, context.toolName, fingerprint);
      if (prior === "denied") {
        return { allow: false, status: "denied", summary: "该动作已由产品负责人拒绝，未执行" };
      }
      if (prior === "approved") {
        return { allow: false, status: "succeeded", summary: "该动作已获批准，但对应工具尚未注册真实实现" };
      }
      this.options.records.createApprovalRequest({
        harnessRunId: context.harnessRunId,
        toolCallId: context.toolCallId,
        toolName: context.toolName,
        args: redactArgs(context.args) as Record<string, unknown>,
        argsFingerprint: fingerprint
      });
      return { allow: false, status: "approval_required", summary: "该重大动作需要产品负责人批准，已暂停等待确认" };
    }
    if (permission === "P1" && !this.options.p1Approved) {
      return { allow: false, status: "denied", summary: "G6 尚未确认，P1 工具未执行" };
    }
    return { allow: true };
  }

  private pathSafetyGate(context: ToolGateContext): PreToolUseResult {
    const violation = this.pathViolation(context.args);
    if (violation) return { allow: false, status: "denied", summary: violation };
    return { allow: true };
  }

  private pathViolation(args: Record<string, unknown>): string | null {
    for (const requested of pathValues(args)) {
      const name = basename(requested);
      if (secretNames.has(name)) return "秘密文件属于 P3，永久拒绝";
      if (manualNames.has(name)) return "三份原始手册不允许通过工作区工具访问";
      const addressed = isAbsolute(requested) ? resolve(requested) : resolve(this.canonicalRoot, requested);
      const canonical = existsSync(addressed) ? realpathSync(addressed) : addressed;
      if (!isInside(this.canonicalRoot, canonical)) return "工作区路径越界，属于 P3，永久拒绝";
      const relativePath = relative(this.canonicalRoot, canonical);
      if (relativePath.startsWith("..")) return "工作区路径越界，属于 P3，永久拒绝";
    }
    return null;
  }

  async execute(input: {
    harnessRunId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<ToolResultEnvelope> {
    const previous = this.options.records.getInvocation(input.harnessRunId, input.toolCallId);
    if (previous?.status !== "started" && previous?.result) {
      return previous.result as ToolResultEnvelope;
    }

    const definition = this.tools.get(input.toolName);
    const permission: PermissionLevel = definition?.permission ??
      (p2Names.has(input.toolName) ? "P2" : "P3");
    const invocation = this.options.records.startInvocation({
      harnessRunId: input.harnessRunId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: redactArgs(input.args) as Record<string, unknown>,
      permission
    });
    const finish = (status: Exclude<ToolInvocationStatus, "started">, summary: string, data?: unknown) => {
      const completedAt = new Date().toISOString();
      const envelope: ToolResultEnvelope = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        status,
        summary,
        artifactIds: [],
        evidenceIds: [],
        startedAt: invocation.startedAt,
        completedAt,
        ...(data === undefined ? {} : { data })
      };
      this.options.records.completeInvocation(input.harnessRunId, input.toolCallId, status, envelope);
      return envelope;
    };

    const context: ToolGateContext = {
      harnessRunId: input.harnessRunId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args,
      permission,
      definition
    };

    for (const hook of this.preHooks) {
      const decision = await hook(context);
      if (!decision.allow) {
        return finish(decision.status, decision.summary, decision.data);
      }
    }

    const parsed = definition!.schema.safeParse(input.args);
    if (!parsed.success || !parsed.data || typeof parsed.data !== "object") {
      return finish("failed", "工具参数校验失败", { issues: parsed.success ? [] : parsed.error.issues });
    }

    try {
      const result = await definition!.execute(parsed.data as Record<string, unknown>, input.signal);
      for (const hook of this.postHooks) {
        await hook({ ...context, status: "succeeded", summary: result.summary, data: result.data });
      }
      const completedAt = new Date().toISOString();
      const envelope: ToolResultEnvelope = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        status: "succeeded",
        summary: result.summary,
        artifactIds: result.artifactIds ?? [],
        evidenceIds: result.evidenceIds ?? [],
        startedAt: invocation.startedAt,
        completedAt,
        ...(result.data === undefined ? {} : { data: result.data })
      };
      this.options.records.completeInvocation(input.harnessRunId, input.toolCallId, "succeeded", envelope);
      return envelope;
    } catch (error) {
      return finish("failed", error instanceof Error ? error.message : "工具执行失败");
    }
  }
}
