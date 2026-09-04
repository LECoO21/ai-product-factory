import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductFactory } from "@factory/production";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import { POST } from "./route";

const previousDataDir = process.env.FACTORY_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "factory-start-run-route-"));
const databasePath = join(directory, "factory.sqlite");

beforeAll(() => {
  process.env.FACTORY_DATA_DIR = directory;
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.FACTORY_DATA_DIR;
  else process.env.FACTORY_DATA_DIR = previousDataDir;
});

const setup = () => {
  const project = createProductFactory(new SqliteProjectRegistry(databasePath)).createProject({
    name: "流程终态测试",
    description: "验证终态产品不可重新开始",
    prd: "创建一个需要经过完整产品生产流程并且能够在终态停止的产品。",
    workspacePath: null
  });
  return { project, runs: new SqliteProductionRunStore(databasePath) };
};

describe("POST /api/projects/:id/runs", () => {
  it("does not reopen a product flow after explicit cancellation", async () => {
    const { project, runs } = setup();
    const cancelled = runs.create(project.id, "理解产品", "intake");
    runs.append(cancelled.id, "harness.command.abort", { reason: "用户取消" });
    runs.transition(cancelled.id, "cancelled", "用户取消");

    const response = await POST(new Request("http://localhost/runs", { method: "POST" }), {
      params: Promise.resolve({ id: project.id })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: "PRODUCT_FLOW_CLOSED",
        userMessage: expect.stringContaining("新建产品")
      })
    }));
    expect(runs.listForProject(project.id)).toHaveLength(1);
  });

  it("does not confuse revision supersession with product termination", async () => {
    const { project, runs } = setup();
    const superseded = runs.create(project.id, "理解产品", "intake");
    runs.transition(superseded.id, "cancelled", "已有修订版本");
    runs.append(superseded.id, "gate.revision_requested", { revisionRunId: "revision-1" });

    const response = await POST(new Request("http://localhost/runs", { method: "POST" }), {
      params: Promise.resolve({ id: project.id })
    });
    const body = await response.json() as { run: { projectId: string } };

    expect(response.status).toBe(201);
    expect(body.run.projectId).toBe(project.id);
    expect(runs.listForProject(project.id)).toHaveLength(2);
  });
});
