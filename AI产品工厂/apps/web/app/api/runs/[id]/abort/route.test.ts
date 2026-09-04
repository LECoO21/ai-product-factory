import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProductFactory } from "@factory/production";
import {
  SqliteCodexRuntimeStore,
  SqliteProductManualIssuanceStore,
  SqliteProductManualSnapshotStore,
  SqliteProductionRunStore,
  SqliteProjectRegistry
} from "@factory/records";
import { POST } from "./route";

const previousDataDir = process.env.FACTORY_DATA_DIR;
const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
] as const;
const manualSnapshot = () => {
  const contents = manualNames.map((name) => `ABORT-MANUAL-SENTINEL:${name}`);
  return {
    stage: "v0.2-b",
    records: manualNames.map((name, index) => ({
      path: `/private/${name}`,
      sha256: createHash("sha256").update(contents[index]!).digest("hex"),
      characters: contents[index]!.length,
      ok: true
    })),
    context: contents.join("\n\n--- 下一份原始手册 ---\n\n")
  };
};

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
    const manualDatabasePath = join(directory, "manual-authority.sqlite");
    const manuals = new SqliteProductManualSnapshotStore(manualDatabasePath);
    manuals.loadOrCreate(project.id, manualSnapshot);
    manuals.close();
    const issuance = new SqliteProductManualIssuanceStore(databasePath);
    const claim = issuance.begin(project.id);
    if (!claim.owner) throw new Error("测试签发标记创建失败");
    issuance.finish(project.id, claim.token);
    issuance.close();
    const threadId = `thread-${status}`;
    const codex = new SqliteCodexRuntimeStore(databasePath);
    codex.saveThreadBinding(project.id, threadId);
    codex.close();

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
    let unexpectedRead = false;
    const afterAbort = new SqliteProductManualSnapshotStore(manualDatabasePath);
    expect(afterAbort.loadOrCreate(project.id, () => {
      unexpectedRead = true;
      return { context: "replacement" };
    })).toEqual({ state: "closed", snapshot: null, error: null });
    expect(unexpectedRead).toBe(false);
    afterAbort.close();
    const afterIssuance = new SqliteProductManualIssuanceStore(databasePath);
    expect(afterIssuance.begin(project.id)).toEqual({ owner: false, state: "closed" });
    afterIssuance.close();
    const cleanup = new SqliteCodexRuntimeStore(databasePath);
    expect(cleanup.claimNextThreadCleanup("route-test-worker")).toMatchObject({
      productFlowId: project.id,
      scopeId: project.id,
      threadId
    });
    cleanup.close();
    expect(readFileSync(manualDatabasePath).toString("utf8"))
      .not.toContain("ABORT-MANUAL-SENTINEL");
    }
  );
});
