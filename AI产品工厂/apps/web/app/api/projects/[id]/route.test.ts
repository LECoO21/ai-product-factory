import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductFactory } from "@factory/production";
import { SqliteCodexRuntimeStore, SqliteProductManualIssuanceStore, SqliteProductManualSnapshotStore, SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";
import { DELETE } from "./route";

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-delete-route-test-"));
  vi.stubEnv("FACTORY_DATA_DIR", directory);
  const databasePath = join(directory, "factory.sqlite");
  const registry = new SqliteProjectRegistry(databasePath);
  const project = createProductFactory(registry).createProject({
    name: "删除接口测试产品", description: "删除接口测试", prd: "验证删除产品接口只处理指定的测试数据，且关闭本产品流程资源。", workspacePath: null
  });
  return { directory, databasePath, registry, project, runs: new SqliteProductionRunStore(databasePath) };
}

const remove = (id: string, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) => DELETE(
  new Request(`http://localhost/api/projects/${id}`, { method: "DELETE", headers }),
  { params: Promise.resolve({ id }) }
);

describe("DELETE /api/projects/:id", () => {
  it("removes the product and idempotently closes resources without reading source manuals", async () => {
    const { directory, databasePath, registry, project, runs } = fixture();
    const run = runs.create(project.id, "测试任务");
    runs.transition(run.id, "waiting_approval");
    const codex = new SqliteCodexRuntimeStore(databasePath);
    codex.saveThreadBinding(project.id, "test-deleted-thread");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await remove(project.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: true });
    }
    expect(registry.get(project.id)).toBeNull();
    expect(runs.get(run.id)).toBeNull();
    expect(codex.claimNextThreadCleanup("test-cleanup-worker")).toMatchObject({ productFlowId: project.id, threadId: "test-deleted-thread" });
    codex.close();
    const issuance = new SqliteProductManualIssuanceStore(databasePath);
    expect(issuance.begin(project.id)).toEqual({ owner: false, state: "closed" });
    issuance.close();
    const snapshots = new SqliteProductManualSnapshotStore(join(directory, "manual-authority.sqlite"));
    const loadManuals = vi.fn(() => ({ context: "should not load" }));
    expect(snapshots.loadOrCreate(project.id, loadManuals).state).toBe("closed");
    expect(loadManuals).not.toHaveBeenCalled();
    snapshots.close();
    registry.close();
  });

  it("rejects running products without changing them", async () => {
    const { registry, project, runs } = fixture();
    const run = runs.create(project.id, "运行中测试任务");
    runs.claimNext("test-worker");
    const response = await remove(project.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "PROJECT_RUNNING" } });
    expect(registry.get(project.id)).not.toBeNull();
    expect(runs.get(run.id)?.status).toBe("running");
    registry.close();
  });

  it("returns 404 for an unknown product", async () => {
    const { registry } = fixture();
    expect((await remove("missing-project")).status).toBe(404);
    registry.close();
  });

  it.each([{}, { origin: "https://external.example", host: "localhost" }, { origin: "http://localhost", host: "external.example" }])(
    "rejects missing or cross-origin headers: %j", async (headers) => {
      const { registry, project } = fixture();
      expect((await remove(project.id, headers)).status).toBe(403);
      expect(registry.get(project.id)).not.toBeNull();
      registry.close();
    }
  );
});
