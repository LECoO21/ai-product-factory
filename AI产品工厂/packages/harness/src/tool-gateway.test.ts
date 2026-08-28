import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SqliteHarnessRecordStore } from "@factory/records";
import { ToolGateway, type HarnessToolDefinition } from "./tool-gateway";

const createContext = (p1Approved = true) => {
  const directory = mkdtempSync(join(tmpdir(), "factory-gateway-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const records = new SqliteHarnessRecordStore(join(directory, "factory.sqlite"));
  const task = records.createTask("production-run", "test");
  const run = records.createHarnessRun({
    productionRunId: "production-run",
    taskId: task.id,
    sessionPath: "session.jsonl",
    promptVersion: "1.0.0",
    model: "deepseek-v4-flash"
  });
  return {
    directory,
    workspaceRoot,
    run,
    records,
    gateway: new ToolGateway({ records, workspaceRoot, p1Approved })
  };
};

const tool = (name: string, permission: "P0" | "P1", execute: HarnessToolDefinition["execute"]): HarnessToolDefinition => ({
  name,
  permission,
  schema: z.object({ path: z.string().optional() }),
  execute
});

describe("ToolGateway", () => {
  it("allows P0 and approved P1 tools, while replaying the saved result once", async () => {
    const context = createContext();
    let sideEffects = 0;
    context.gateway.register(tool("workspace.read", "P0", async () => ({ summary: "read" })));
    context.gateway.register(tool("workspace.patch", "P1", async () => {
      sideEffects += 1;
      return { summary: "patched" };
    }));

    const read = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "read-1",
      toolName: "workspace.read",
      args: { path: "file.ts" }
    });
    const first = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "patch-1",
      toolName: "workspace.patch",
      args: { path: "file.ts" }
    });
    const replay = await context.gateway.execute({
      harnessRunId: context.run.id,
      toolCallId: "patch-1",
      toolName: "workspace.patch",
      args: { path: "file.ts" }
    });

    expect(read.status).toBe("succeeded");
    expect(first).toEqual(replay);
    expect(sideEffects).toBe(1);
  });

  it("blocks P1 before G6 approval and reserves P2/P3 with zero side effects", async () => {
    const context = createContext(false);
    let sideEffects = 0;
    context.gateway.register(tool("workspace.patch", "P1", async () => {
      sideEffects += 1;
      return { summary: "should not run" };
    }));

    const unapproved = await context.gateway.execute({
      harnessRunId: context.run.id, toolCallId: "p1", toolName: "workspace.patch", args: { path: "file.ts" }
    });
    const p2 = await context.gateway.execute({
      harnessRunId: context.run.id, toolCallId: "p2", toolName: "git.push", args: {}
    });
    const p3 = await context.gateway.execute({
      harnessRunId: context.run.id, toolCallId: "p3", toolName: "secret.read", args: { path: ".env" }
    });

    expect(unapproved.status).toBe("denied");
    expect(p2.status).toBe("approval_required");
    expect(p3.status).toBe("denied");
    expect(sideEffects).toBe(0);
  });

  it("denies parent, absolute, secret and symlink path escapes", async () => {
    const context = createContext();
    writeFileSync(join(context.directory, "outside.txt"), "secret");
    symlinkSync(join(context.directory, "outside.txt"), join(context.workspaceRoot, "escape.txt"));
    context.gateway.register(tool("workspace.read", "P0", async () => ({ summary: "should not run" })));

    const paths = ["../outside.txt", join(context.directory, "outside.txt"), ".env", "escape.txt"];
    for (const [index, path] of paths.entries()) {
      const result = await context.gateway.execute({
        harnessRunId: context.run.id,
        toolCallId: `escape-${index}`,
        toolName: "workspace.read",
        args: { path }
      });
      expect(result.status).toBe("denied");
    }
  });
});
