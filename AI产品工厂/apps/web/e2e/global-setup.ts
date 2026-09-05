import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProductFactory, createProductionController } from "@factory/production";
import { SqliteProductionRunStore, SqliteProjectRegistry } from "@factory/records";

export default function globalSetup() {
  const dataDir = process.env.FACTORY_E2E_DATA_DIR;
  if (!dataDir) throw new Error("E2E data directory was not configured");

  const registry = new SqliteProjectRegistry();
  const factory = createProductFactory(registry);
  const runs = new SqliteProductionRunStore();
  const controller = createProductionController(runs);
  const requirement = "为单人产品负责人提供一个通用 AI 产品需求整理工作台，支持保存结果和逐步确认。";

  const confirmableProject = factory.createProject({
    name: "E2E 等待确认产品",
    description: "通用产品",
    prd: requirement,
    workspacePath: null
  });
  const confirmableRun = runs.create(confirmableProject.id, "生成产品理解结果");
  runs.append(confirmableRun.id, "text.delta", {
    delta: "# PRD 接单体检 | 产品理解摘要\n\n产品面向单人产品负责人，核心任务是输入任意产品需求并获得可检查、可继续的结构化结果。"
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

  const secondStageProject = factory.createProject({
    name: "E2E 第二阶段产品",
    description: "验证确认后进入第二阶段",
    prd: requirement,
    workspacePath: null
  });
  const secondStageRun = runs.create(secondStageProject.id, "生成产品理解结果");
  runs.append(secondStageRun.id, "text.delta", {
    delta: "产品需求已经理解完成，可以确认后进入技术方案阶段，并继续沿用同一个产品流程。"
  });
  runs.append(secondStageRun.id, "agent.completed");
  runs.transition(secondStageRun.id, "waiting_approval");

  const revisionProject = factory.createProject({
    name: "E2E 确认前修改产品",
    description: "验证确认区修改意见",
    prd: requirement,
    workspacePath: null
  });
  const revisionSourceRun = runs.create(revisionProject.id, "生成待修改的产品理解结果");
  runs.append(revisionSourceRun.id, "text.delta", {
    delta: "这是待产品负责人检查的完整结果，可以在确认前提交修改意见。"
  });
  runs.append(revisionSourceRun.id, "agent.completed");
  runs.transition(revisionSourceRun.id, "waiting_approval");

  const historyProject = factory.createProject({
    name: "E2E 完整对话产品",
    description: "验证多轮方案和确认历史",
    prd: requirement,
    workspacePath: null
  });
  let historicalRun = runs.create(historyProject.id, "生成产品理解结果");
  for (let version = 1; version <= 6; version += 1) {
    runs.append(historicalRun.id, "text.delta", {
      delta: [
        `## 第 ${version} 版需求分析`,
        "产品为单人产品负责人提供需求整理、方案生成和逐步确认的完整流程。",
        "### 核心任务",
        "- 输入产品需求，获得可阅读的结构化方案。",
        "- 在同一条对话中补充意见，检查修改后的完整结果。",
        "- 保存每一次生成结果、确认和补充回答，刷新后继续查看。",
        "### 验收方式",
        "打开产品后，可以从最初需求开始逐条回看；所有历史版本保留，不因进入下一阶段被覆盖。"
      ].join("\n\n")
    });
    runs.append(historicalRun.id, "agent.completed");
    runs.transition(historicalRun.id, "waiting_approval");
    if (version < 6) {
      historicalRun = controller.reviseFromFeedback(
        historicalRun.id,
        `第 ${version} 轮补充：保留每一版方案，并展示完整确认记录。`
      ).revisionRun;
    }
  }
  const historyRun = controller.approveAndContinue(historicalRun.id).nextRun;
  if (!historyRun) throw new Error("历史对话测试需要技术方案阶段");
  runs.append(historyRun.id, "text.delta", {
    delta: "最终技术方案：已整合六轮需求分析和补充回答，对话记录按产品完整保存，所有阶段的确认均可回看。"
  });
  runs.append(historyRun.id, "agent.completed");
  runs.transition(historyRun.id, "waiting_approval");

  writeFileSync(
    join(dataDir, "fixtures.json"),
    JSON.stringify({
      confirmableRunId: confirmableRun.id,
      failedRunId: failedRun.id,
      secondStageRunId: secondStageRun.id,
      revisionSourceRunId: revisionSourceRun.id,
      historyRunId: historyRun.id
    }),
    "utf8"
  );
}
