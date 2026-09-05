import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createProductFactory } from "@factory/production";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "./index";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-deletion-test-"));
  const databasePath = join(directory, "factory.sqlite");
  const registry = new SqliteProjectRegistry(databasePath);
  const factory = createProductFactory(registry);
  const create = (name: string) => factory.createProject({
    name, description: "删除产品测试", prd: "验证产品删除操作安全、可恢复，且不影响其他产品及本地代码。", workspacePath: directory
  });
  return { directory, databasePath, registry, create, runs: new SqliteProductionRunStore(databasePath) };
}

describe("logical product deletion", () => {
  it("hides the product and runs after reopening, retaining audit records and local files", () => {
    const { directory, databasePath, registry, create, runs } = fixture();
    const project = create("待删除测试产品");
    const other = create("保留测试产品");
    const run = runs.create(project.id, "待执行任务");
    const sentinel = join(directory, "generated.html");
    writeFileSync(sentinel, "test-only-generated-file");

    expect(registry.deleteProject(project.id)).toBe("deleted");
    registry.close();
    const reopened = new SqliteProjectRegistry(databasePath);
    expect(reopened.get(project.id)).toBeNull();
    expect(reopened.list().map((entry) => entry.id)).toEqual([other.id]);
    expect(reopened.events(project.id).filter((entry) => entry.type === "project.deleted"))
      .toMatchObject([{ payload: { workspaceDeleted: false } }]);
    expect(new SqliteProductionRunStore(databasePath).get(run.id)).toBeNull();
    expect(runs.listForProject(project.id)).toEqual([]);
    expect(runs.events(run.id).at(-1)).toMatchObject({ type: "run.cancelled", payload: { reason: "project_deleted" } });
    expect(runs.claimNext("test-worker")).toBeNull();
    expect(() => runs.create(project.id, "不能重新开始")).toThrow("产品不存在或已删除");
    expect(readFileSync(sentinel, "utf8")).toBe("test-only-generated-file");
    const raw = new Database(databasePath);
    expect(raw.prepare("SELECT status FROM production_runs WHERE id = ?").get(run.id)).toEqual({ status: "cancelled" });
    raw.close();
    reopened.close();
  });

  it("rejects deletion while running without cancelling queued work; permits it after stop", () => {
    const { registry, create, runs } = fixture();
    const project = create("运行中测试产品");
    const run = runs.create(project.id, "正在运行");
    expect(runs.claimNext("test-worker")?.id).toBe(run.id);
    const queued = runs.create(project.id, "排队中的任务");
    expect(registry.deleteProject(project.id)).toBe("running");
    expect(registry.get(project.id)).not.toBeNull();
    expect(runs.get(run.id)?.status).toBe("running");
    expect(runs.get(queued.id)?.status).toBe("ready");
    expect(registry.events(project.id).some((entry) => entry.type === "project.deleted")).toBe(false);
    runs.transition(run.id, "cancelled");
    expect(registry.deleteProject(project.id)).toBe("deleted");
    registry.close();
  });

  it("is idempotent and does not hide unrelated queued runs", () => {
    const { registry, create, runs } = fixture();
    const project = create("待删除测试产品");
    const other = create("保留测试产品");
    runs.create(project.id, "取消此任务");
    const otherRun = runs.create(other.id, "保留此任务");
    expect(registry.deleteProject("missing-project")).toBe("not_found");
    expect(registry.deleteProject(project.id)).toBe("deleted");
    expect(registry.deleteProject(project.id)).toBe("deleted");
    expect(registry.events(project.id).filter((entry) => entry.type === "project.deleted")).toHaveLength(1);
    expect(runs.claimNext("test-worker")?.id).toBe(otherRun.id);
    registry.close();
  });

  it("migrates existing databases without losing existing products", () => {
    const { databasePath, registry, create } = fixture();
    const project = create("旧版本测试产品");
    registry.close();
    const raw = new Database(databasePath);
    raw.exec("ALTER TABLE projects DROP COLUMN deleted_at");
    raw.close();
    const migrated = new SqliteProjectRegistry(databasePath);
    expect(migrated.get(project.id)).toEqual(project);
    expect(migrated.deleteProject(project.id)).toBe("deleted");
    migrated.close();
  });
});
