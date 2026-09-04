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
  const contents = manualNames.map((name) => `APPROVE-MANUAL-SENTINEL:${name}`);
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

const setup = (stage: "intake" | "release-handoff") => {
  const directory = mkdtempSync(join(tmpdir(), "factory-approve-route-"));
  process.env.FACTORY_DATA_DIR = directory;
  const databasePath = join(directory, "factory.sqlite");
  const project = createProductFactory(new SqliteProjectRegistry(databasePath)).createProject({
    name: "确认流程测试",
    description: "验证跨 Run 快照生命周期",
    prd: "创建一个从产品理解逐步确认到上线检查的通用产品生产流程。",
    workspacePath: null
  });
  const runs = new SqliteProductionRunStore(databasePath);
  const run = runs.create(project.id, `执行 ${stage}`, stage);
  runs.append(run.id, "text.delta", { delta: "这是一份已经完整生成并可供负责人确认的阶段结果。" });
  runs.append(run.id, "agent.completed");
  runs.transition(run.id, "waiting_approval");
  const manualDatabasePath = join(directory, "manual-authority.sqlite");
  const manuals = new SqliteProductManualSnapshotStore(manualDatabasePath);
  const snapshot = manualSnapshot();
  manuals.loadOrCreate(project.id, () => snapshot);
  manuals.close();
  const issuance = new SqliteProductManualIssuanceStore(databasePath);
  const claim = issuance.begin(project.id);
  if (!claim.owner) throw new Error("测试签发标记创建失败");
  issuance.finish(project.id, claim.token);
  issuance.close();
  const threadId = `thread-${stage}`;
  const codex = new SqliteCodexRuntimeStore(databasePath);
  codex.saveThreadBinding(project.id, threadId);
  codex.close();
  return { databasePath, manualDatabasePath, project, run, snapshot, threadId };
};

describe("POST /api/runs/:id/approve", () => {
  it("creates the second-stage Run under the same product and keeps its one snapshot", async () => {
    const { databasePath, project, run, snapshot, manualDatabasePath } = setup("intake");

    const response = await POST(new Request("http://localhost/approve", { method: "POST" }), {
      params: Promise.resolve({ id: run.id })
    });
    const body = await response.json() as {
      nextRun: { id: string; projectId: string; stage: string } | null;
    };

    expect(response.status).toBe(201);
    expect(body.nextRun).toMatchObject({ projectId: project.id, stage: "adaptation" });
    expect(body.nextRun?.id).not.toBe(run.id);
    let reread = false;
    const manuals = new SqliteProductManualSnapshotStore(manualDatabasePath);
    expect(manuals.loadOrCreate(project.id, () => {
      reread = true;
      return { replacement: true };
    })).toEqual({ state: "active", snapshot, error: null });
    expect(reread).toBe(false);
    manuals.close();
    const issuance = new SqliteProductManualIssuanceStore(databasePath);
    expect(issuance.begin(project.id)).toEqual({ owner: false, state: "issued" });
    issuance.close();
    const cleanup = new SqliteCodexRuntimeStore(databasePath);
    expect(cleanup.claimNextThreadCleanup("route-test-worker")).toBeNull();
    cleanup.close();
  });

  it("removes the manual body and closes the product after its terminal confirmation", async () => {
    const { databasePath, project, run, manualDatabasePath, threadId } = setup("release-handoff");

    const response = await POST(new Request("http://localhost/approve", { method: "POST" }), {
      params: Promise.resolve({ id: run.id })
    });
    const body = await response.json() as { nextRun: unknown };

    expect(response.status).toBe(201);
    expect(body.nextRun).toBeNull();
    let reread = false;
    const manuals = new SqliteProductManualSnapshotStore(manualDatabasePath);
    expect(manuals.loadOrCreate(project.id, () => {
      reread = true;
      return { replacement: true };
    })).toEqual({ state: "closed", snapshot: null, error: null });
    expect(reread).toBe(false);
    manuals.close();
    const issuance = new SqliteProductManualIssuanceStore(databasePath);
    expect(issuance.begin(project.id)).toEqual({ owner: false, state: "closed" });
    issuance.close();
    const cleanup = new SqliteCodexRuntimeStore(databasePath);
    expect(cleanup.claimNextThreadCleanup("route-test-worker")).toMatchObject({
      productFlowId: project.id,
      scopeId: project.id,
      threadId
    });
    cleanup.close();
    expect(readFileSync(manualDatabasePath).toString("utf8"))
      .not.toContain("APPROVE-MANUAL-SENTINEL");
  });
});
