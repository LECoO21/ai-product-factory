import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductFactory } from "@factory/production";
import { SqliteHarnessRecordStore, SqliteProjectRegistry, SqliteProductionRunStore } from "@factory/records";
import { GET } from "./route";
import { GET as preview } from "../../prototype/route";

afterEach(() => vi.unstubAllEnvs());

describe("generated artifact isolation", () => {
  it("downloads active content and returns 404 after product deletion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "prodline-artifact-test-"));
    vi.stubEnv("FACTORY_DATA_DIR", directory);
    const registry = new SqliteProjectRegistry();
    const factory = createProductFactory(registry);
    const project = factory.createProject({ name: "产物安全测试", description: "测试", prd: "只验证隔离测试产品的下载行为，不执行真实生产或发布。", workspacePath: null });
    const runs = new SqliteProductionRunStore();
    const run = runs.create(project.id, "生成测试产物");
    const records = new SqliteHarnessRecordStore();
    const task = records.createTask(run.id, "测试");
    const harness = records.createHarnessRun({ productionRunId: run.id, taskId: task.id,
      sessionPath: "test.jsonl", promptVersion: "1", model: "fixture" });
    const path = join(directory, "unsafe.html");
    const content = '<!doctype html><html><body><button onclick="this.textContent=1">运行</button></body></html>';
    writeFileSync(path, content);
    const artifact = records.registerArtifact({ runId: harness.id, kind: "html", path, mimeType: "text/html" });
    const get = () => GET(new Request("http://localhost/test"), { params: Promise.resolve({ id: run.id, artifactId: artifact.id }) });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox;");
    runs.append(run.id, "artifact.created", { kind: "product-prototype-html", content });
    const previewResponse = await preview(new Request("http://localhost/test"), { params: Promise.resolve({ id: run.id }) });
    expect(previewResponse.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts;");
    expect(previewResponse.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");
    registry.deleteProject(project.id);
    expect((await get()).status).toBe(404);
    registry.close();
  });
});
