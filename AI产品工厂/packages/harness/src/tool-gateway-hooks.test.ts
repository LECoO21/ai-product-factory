import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SqliteHarnessRecordStore } from "@factory/records";
import { ToolGateway, type HarnessToolDefinition } from "./tool-gateway";

const createContext = () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-hooks-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
  const task = records.createTask("production-run", "test");
  const run = records.createHarnessRun({
    productionRunId: "production-run",
    taskId: task.id,
    sessionPath: "session.jsonl",
    promptVersion: "1.0.0",
    model: "account-default"
  });
  return { records, workspaceRoot, run, gateway: new ToolGateway({ records, workspaceRoot, p1Approved: true }) };
};

const plainTool = (): HarnessToolDefinition => ({
  name: "my.tool",
  permission: "P0",
  schema: z.object({ path: z.string().optional(), token: z.string().optional() }),
  execute: async () => ({ summary: "ok" })
});

describe("ToolGateway 统一小关卡", () => {
  it("新工具不写任何检查，仍自动获得越界拦截、脱敏与记账", async () => {
    const context = createContext();
    context.gateway.register(plainTool());

    const escape = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "t-escape",
      toolName: "my.tool",
      args: { path: "../outside.txt", token: "abc123" }
    });
    expect(escape.status).toBe("denied");

    const ok = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "t-ok",
      toolName: "my.tool",
      args: { path: "file.txt", token: "abc123" }
    });
    expect(ok.status).toBe("succeeded");

    const invocation = context.records.listInvocations(context.run.id)
      .find((item) => item.toolCallId === "t-ok");
    expect(invocation).toBeDefined();
    expect(invocation!.args.token).toBe("[REDACTED]");
    expect(invocation!.permission).toBe("P0");
  });

  it("支持注册额外的 Pre 和 Post 关卡", async () => {
    const context = createContext();
    const blocked: string[] = [];
    const completed: string[] = [];
    context.gateway.addPreHook(({ toolName }) => {
      if (toolName === "my.tool") {
        return { allow: false, status: "denied", summary: "被自定义关卡拦截" };
      }
      return { allow: true };
    });
    context.gateway.addPostHook(({ toolName }) => {
      completed.push(toolName);
    });
    context.gateway.register(plainTool());

    const result = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "t-custom",
      toolName: "my.tool",
      args: { path: "file.txt" }
    });

    expect(result.status).toBe("denied");
    expect(result.summary).toBe("被自定义关卡拦截");
    expect(blocked).toEqual([]);
    expect(completed).toEqual([]);
  });
});
