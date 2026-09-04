import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SqliteHarnessRecordStore } from "@factory/records";
import { ManualAuthority } from "./manual-authority";
import type { HarnessToolDefinition } from "./tool-gateway";
import { ControlledCommandRunner, LocalWorkspace } from "./workspace";
import { BackgroundRunner } from "./background-runner";

export type CoreToolsOptions = {
  authority: ManualAuthority;
  workspace: LocalWorkspace;
  commands: ControlledCommandRunner;
  records: SqliteHarnessRecordStore;
  harnessRunId: string;
  taskId: string;
  reportRoot: string;
  completionCriteria: string[];
};

const jsonReport = (path: string, value: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const createCoreToolDefinitions = (options: CoreToolsOptions): HarnessToolDefinition[] => [
  {
    name: "manual.verify",
    permission: "P0",
    schema: z.object({ authorityVersion: z.string() }),
    execute: async () => ({ summary: "三份原始手册完整性校验通过", data: options.authority.verify() })
  },
  {
    name: "manual.load",
    permission: "P0",
    schema: z.object({ stage: z.literal("v0.2-b") }),
    execute: async () => {
      const loaded = options.authority.load("v0.2-b");
      return { summary: "三份原始手册已按固定顺序加载到受保护上下文", data: loaded.records };
    }
  },
  {
    name: "workspace.list",
    permission: "P0",
    schema: z.object({ path: z.string().default("."), depth: z.number().int().min(0).max(4).default(2), limit: z.number().int().min(1).max(500).default(200) }),
    execute: async (args) => ({ summary: "工作区目录读取完成", data: options.workspace.list(args as { path: string; depth: number; limit: number }) })
  },
  {
    name: "workspace.read",
    permission: "P0",
    schema: z.object({ path: z.string(), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional(), maxBytes: z.number().int().positive().max(262_144).optional() }),
    execute: async (args) => ({ summary: `已读取 ${String(args.path)}`, data: options.workspace.read(args as { path: string; startLine?: number; endLine?: number; maxBytes?: number }) })
  },
  {
    name: "workspace.search",
    permission: "P0",
    schema: z.object({ query: z.string().min(1), paths: z.array(z.string()).optional(), limit: z.number().int().positive().max(200).optional() }),
    execute: async (args) => ({ summary: `已搜索 ${String(args.query)}`, data: options.workspace.search(args as { query: string; paths?: string[]; limit?: number }) })
  },
  {
    name: "workspace.patch",
    permission: "P1",
    schema: z.object({ patch: z.string().min(1), expectedHashes: z.record(z.string(), z.string().length(64)) }),
    execute: async (args) => ({ summary: "工作区补丁已应用", data: options.workspace.patch(args as { patch: string; expectedHashes: Record<string, string> }) })
  },
  {
    name: "git.inspect",
    permission: "P0",
    schema: z.object({ operation: z.enum(["status", "diff", "log"]), maxEntries: z.number().int().positive().max(100).optional() }),
    execute: async (args, signal) => {
      const operation = args.operation as "status" | "diff" | "log";
      const commandArgs = operation === "log"
        ? ["log", "--oneline", `-${Number(args.maxEntries ?? 20)}`]
        : operation === "status" ? ["status", "--short"] : ["diff", "--no-ext-diff"];
      const result = await options.commands.run({ program: "git", args: commandArgs, cwd: ".", timeoutMs: 30_000, ...(signal ? { signal } : {}) });
      if (operation === "diff") {
        const diffPath = join(options.reportRoot, "diff.patch");
        mkdirSync(options.reportRoot, { recursive: true });
        writeFileSync(diffPath, result.stdout, "utf8");
        const artifact = options.records.registerArtifact({ runId: options.harnessRunId, kind: "workspace-diff",
          path: diffPath, mimeType: "text/x-diff" });
        return { summary: "Git diff 已生成并登记", data: result, artifactIds: [artifact.id] };
      }
      return { summary: `Git ${operation} 完成`, data: result };
    }
  },
  {
    name: "command.run",
    permission: "P1",
    schema: z.object({ program: z.enum(["npm", "node", "git"]), args: z.array(z.string()).max(30), cwd: z.string().default("."), timeoutMs: z.number().int().positive().max(180_000).default(180_000) }),
    execute: async (args, signal) => ({
      summary: "受控命令执行完成",
      data: await options.commands.run({
        program: args.program as string,
        args: args.args as string[],
        cwd: args.cwd as string,
        timeoutMs: args.timeoutMs as number,
        ...(signal ? { signal } : {})
      })
    })
  },
  {
    name: "test.run",
    permission: "P1",
    schema: z.object({ script: z.enum(["test", "typecheck", "lint", "build"]), cwd: z.string().default("."), target: z.string().optional() }),
    execute: async (args, signal) => {
      const script = args.script as string;
      const commandArgs = script === "test" ? ["test"] : ["run", script];
      if (typeof args.target === "string" && args.target) commandArgs.push("--", args.target);
      const result = await options.commands.run({ program: "npm", args: commandArgs, cwd: args.cwd as string,
        timeoutMs: 180_000, ...(signal ? { signal } : {}) });
      const reportPath = join(options.reportRoot, "tests", `${Date.now()}-${script}.json`);
      jsonReport(reportPath, result);
      const artifact = options.records.registerArtifact({ runId: options.harnessRunId, kind: "test-report",
        path: reportPath, mimeType: "application/json" });
      const passed = result.exitCode === 0;
      const evidenceIds: string[] = [];
      if (passed) {
        for (const criterionId of options.completionCriteria) {
          const evidence = options.records.registerEvidence({
            runId: options.harnessRunId,
            criterionId,
            kind: "auto-test-passed",
            artifactId: artifact.id,
            observation: { exitCode: result.exitCode, script },
            passed: true
          });
          evidenceIds.push(evidence.id);
        }
      }
      return {
        summary: passed ? `${script} 检查通过` : `${script} 检查未通过（exitCode ${result.exitCode}）`,
        data: result,
        artifactIds: [artifact.id],
        evidenceIds
      };
    }
  },
  {
    name: "workplan.update",
    permission: "P1",
    schema: z.object({ items: z.array(z.object({ id: z.string(), text: z.string().min(1), status: z.enum(["pending", "in_progress", "completed"]) })).min(1).max(20) }),
    execute: async (args) => ({ summary: "工作计划已更新", data: options.records.replacePlan(
      options.harnessRunId,
      args.items as Array<{ id: string; text: string; status: "pending" | "in_progress" | "completed" }>
    ) })
  },
  {
    name: "task.manage",
    permission: "P1",
    schema: z.object({ action: z.enum(["get", "update"]), taskId: z.string(), status: z.enum(["in_progress", "completed", "blocked", "failed", "cancelled", "interrupted"]).optional(), note: z.string().optional() }),
    execute: async (args) => {
      if (args.taskId !== options.taskId) throw new Error("不能操作其他 Task");
      const task = args.action === "get" ? options.records.getTask(options.taskId) :
        options.records.updateTask(options.taskId, args.status as "in_progress" | "completed" | "blocked" | "failed" | "cancelled" | "interrupted", typeof args.note === "string" ? args.note : null);
      return { summary: "Task 状态已读取或更新", data: task };
    }
  },
  {
    name: "artifact.register",
    permission: "P1",
    schema: z.object({ kind: z.string(), path: z.string(), mimeType: z.string(), sourceToolCallId: z.string() }),
    execute: async (args) => {
      const artifact = options.records.registerArtifact({ runId: options.harnessRunId, kind: args.kind as string,
        path: join(options.workspace.root, args.path as string), mimeType: args.mimeType as string,
        sourceToolCallId: args.sourceToolCallId as string });
      return { summary: "产物已登记", data: artifact, artifactIds: [artifact.id] };
    }
  },
  {
    name: "evidence.register",
    permission: "P1",
    schema: z.object({ criterionId: z.string(), kind: z.string(), artifactId: z.string().optional(), observation: z.record(z.string(), z.unknown()), passed: z.boolean() }),
    execute: async (args) => {
      const evidence = options.records.registerEvidence({ runId: options.harnessRunId,
        criterionId: args.criterionId as string, kind: args.kind as string,
        artifactId: typeof args.artifactId === "string" ? args.artifactId : null,
        observation: args.observation as Record<string, unknown>, passed: args.passed as boolean });
      return { summary: "证据已登记", data: evidence, evidenceIds: [evidence.id] };
    }
  }
];

export const createBackgroundToolDefinition = (
  runner: BackgroundRunner,
  taskId: string
): HarnessToolDefinition => ({
  name: "background.manage",
  permission: "P1",
  schema: z.object({ action: z.enum(["get", "cancel"]), jobId: z.string() }),
  execute: async (args) => {
    const job = runner.get(args.jobId as string);
    if (!job || job.taskId !== taskId) throw new Error("不能操作其他 Task 的后台任务");
    const result = args.action === "cancel" ? runner.cancel(job.id) : job;
    return { summary: args.action === "cancel" ? "后台任务已取消" : "后台任务状态已读取", data: result };
  }
});
