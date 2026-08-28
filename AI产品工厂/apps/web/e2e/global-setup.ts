import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProductFactory } from "@factory/production";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";

export default function globalSetup() {
  const dataDir = process.env.FACTORY_E2E_DATA_DIR;
  if (!dataDir) throw new Error("E2E data directory was not configured");

  const registry = new SqliteProjectRegistry();
  const factory = createProductFactory(registry);
  const runs = new SqliteProductionRunStore();
  const requirement = "为单人产品负责人提供一个通用 AI 产品需求整理工作台，支持保存结果和逐步确认。";

  const confirmableProject = factory.createProject({
    name: "E2E 等待确认产品",
    description: "通用产品",
    prd: requirement,
    workspacePath: null
  });
  const confirmableRun = runs.create(confirmableProject.id, "生成产品理解结果");
  runs.append(confirmableRun.id, "text.delta", {
    delta: "产品面向单人产品负责人，核心任务是输入任意产品需求并获得可检查、可继续的结构化结果。"
  });
  runs.append(confirmableRun.id, "agent.completed");
  runs.transition(confirmableRun.id, "waiting_approval");

  const failedProject = factory.createProject({
    name: "E2E 失败产品",
    description: "通用产品",
    prd: requirement,
    workspacePath: null
  });
  const failedRun = runs.create(failedProject.id, "验证失败恢复");
  runs.append(failedRun.id, "text.delta", { delta: "已有的部分分析结果会被保留，方便用户检查失败前已经完成的内容。" });
  runs.append(failedRun.id, "agent.completed");
  runs.append(failedRun.id, "agent.failed", { message: "确定性测试未通过" });
  runs.transition(failedRun.id, "failed", "确定性测试未通过");

  writeFileSync(
    join(dataDir, "fixtures.json"),
    JSON.stringify({ confirmableRunId: confirmableRun.id, failedRunId: failedRun.id }),
    "utf8"
  );
}
