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
const p3Names = new Set(["secret.read", "manual.modify", "policy.bypass"]);
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

const pathValues = (args: Record<string, unknown>) =>
  Object.entries(args).flatMap(([key, value]) => {
    if (!/(^path$|paths$|cwd$)/i.test(key)) return [];
    if (typeof value === "string") return [value];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  });

export class ToolGateway {
  private readonly tools = new Map<string, HarnessToolDefinition>();
  private readonly canonicalRoot: string;

  constructor(private readonly options: ToolGatewayOptions) {
    this.canonicalRoot = realpathSync(options.workspaceRoot);
  }

  register(definition: HarnessToolDefinition) {
    if (this.tools.has(definition.name)) throw new Error(`工具重复注册：${definition.name}`);
    this.tools.set(definition.name, definition);
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

    if (permission === "P2") return finish("approval_required", "该重大动作需要重新确认生产单，未执行");
    if (permission === "P3") return finish("denied", "该动作超出永久安全边界，未执行");
    const violation = this.pathViolation(input.args);
    if (violation) return finish("denied", violation);
    if (permission === "P1" && !this.options.p1Approved) {
      return finish("denied", "G6 尚未确认，P1 工具未执行");
    }
    const parsed = definition!.schema.safeParse(input.args);
    if (!parsed.success || !parsed.data || typeof parsed.data !== "object") {
      return finish("failed", "工具参数校验失败", { issues: parsed.success ? [] : parsed.error.issues });
    }

    try {
      const result = await definition!.execute(parsed.data as Record<string, unknown>, input.signal);
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
