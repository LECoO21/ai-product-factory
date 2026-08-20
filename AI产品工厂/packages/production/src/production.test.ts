import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SqliteProjectRegistry } from "@factory/records";
import { createProductFactory } from "./index";

describe("LocalProductFactory", () => {
  it("creates, persists and reloads a product project", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-test-"));
    const databasePath = join(directory, "factory.sqlite");
    const factory = createProductFactory(new SqliteProjectRegistry(databasePath));

    const created = factory.createProject({
      name: "运营内容工作台",
      description: "验证非游戏产品蓝图",
      prd: "创建一个供运营使用的 Web 工作台，通过大模型异步生成内容，需要账号登录和发布前确认。",
      workspacePath: null
    });

    expect(factory.getProject(created.id)).toEqual(created);
    expect(factory.listProjects()).toHaveLength(1);
    expect(factory.listProjects()[0]?.blueprint.capabilityPacks).toContain("agent-runtime");

    const reopened = createProductFactory(new SqliteProjectRegistry(databasePath));
    expect(reopened.getProject(created.id)?.name).toBe("运营内容工作台");
  });
});
