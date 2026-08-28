import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProductFactory } from "@factory/production";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import { POST } from "./route";

const previousDataDir = process.env.FACTORY_DATA_DIR;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.FACTORY_DATA_DIR;
  else process.env.FACTORY_DATA_DIR = previousDataDir;
});

describe("POST /api/runs/:id/abort", () => {
  it.each(["waiting_approval", "succeeded"] as const)(
    "cancels a %s run that is still waiting for a decision",
    async (status) => {
    const directory = mkdtempSync(join(tmpdir(), "factory-abort-route-"));
    process.env.FACTORY_DATA_DIR = directory;
    const databasePath = join(directory, "factory.sqlite");
    const project = createProductFactory(new SqliteProjectRegistry(databasePath)).createProject({
      name: "取消任务测试",
      description: "验证首页取消按钮",
      prd: "创建一个等待用户确认并且可以从首页取消的产品任务。",
      workspacePath: null
    });
    const runs = new SqliteProductionRunStore(databasePath);
    const run = runs.create(project.id, "生成产品理解", "intake");
    runs.transition(run.id, status);

    const response = await POST(
      new Request(`http://localhost/api/runs/${run.id}/abort`, {
        method: "POST",
        body: JSON.stringify({ reason: "用户取消", idempotencyKey: "cancel-test-1" })
      }),
      { params: Promise.resolve({ id: run.id }) }
    );

    expect(response.status).toBe(200);
    expect(runs.get(run.id)?.status).toBe("cancelled");
    expect(runs.events(run.id).map((event) => event.type)).toContain("harness.command.abort");
    }
  );
});
