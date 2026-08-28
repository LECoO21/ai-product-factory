import type { ProductionRun, RunEvent } from "@factory/shared";

export type ReleaseHistoryItem = {
  run: ProductionRun;
  events: RunEvent[];
};

export type ReleaseReadinessCheck = {
  id: string;
  label: string;
  passed: boolean;
  evidence: string;
};

export type ReleaseReadinessResult = {
  passed: boolean;
  checks: ReleaseReadinessCheck[];
  markdown: string;
};

const outputOf = (item: ReleaseHistoryItem | undefined) =>
  item?.events
    .filter((event) => event.type === "text.delta")
    .map((event) => String(event.payload.delta ?? ""))
    .join("") ?? "";

const findSucceeded = (history: ReleaseHistoryItem[], stage: ProductionRun["stage"]) =>
  history.find((item) => item.run.stage === stage && item.run.status === "succeeded");

const containsDeploymentAction = (history: ReleaseHistoryItem[]) =>
  history.some((item) => item.events.some((event) =>
    event.type === "deployment.started" ||
    event.type === "release.deploy" ||
    event.payload.toolName === "release.deploy"
  ));

export function evaluateReleaseReadiness(history: ReleaseHistoryItem[]): ReleaseReadinessResult {
  const implementation = findSucceeded(history, "implementation");
  const automatedQuality = findSucceeded(history, "automated-quality");
  const realAcceptance = findSucceeded(history, "real-acceptance");
  const releasePreparation = findSucceeded(history, "release-preparation");
  const releasePlan = outputOf(releasePreparation);

  const checks: ReleaseReadinessCheck[] = [
    {
      id: "product-artifact",
      label: "产品候选版本",
      passed: Boolean(implementation?.events.some((event) =>
        event.type === "artifact.created" && event.payload.kind === "product-prototype-html"
      )),
      evidence: implementation ? `制作批次 ${implementation.run.id}` : "缺少已确认制作批次"
    },
    {
      id: "automated-quality",
      label: "自动检查证据",
      passed: Boolean(automatedQuality?.events.some((event) =>
        event.type === "quality.completed" && event.payload.passed === true
      )),
      evidence: automatedQuality ? `检查批次 ${automatedQuality.run.id}` : "缺少已确认自动检查"
    },
    {
      id: "real-acceptance",
      label: "真实验收证据",
      passed: Boolean(realAcceptance?.events.some((event) => event.type === "gate.approved")),
      evidence: realAcceptance ? `验收批次 ${realAcceptance.run.id}` : "缺少真实产品验收"
    },
    {
      id: "release-plan",
      label: "上线方案",
      passed: releasePlan.replace(/\s/g, "").length >= 20,
      evidence: releasePreparation ? `方案批次 ${releasePreparation.run.id}` : "缺少上线方案"
    },
    {
      id: "rollback-plan",
      label: "回滚方案",
      passed: /回滚|回退/.test(releasePlan),
      evidence: /回滚|回退/.test(releasePlan) ? "上线方案包含回滚安排" : "上线方案未说明回滚"
    },
    {
      id: "no-deployment",
      label: "未执行实际发布",
      passed: !containsDeploymentAction(history),
      evidence: containsDeploymentAction(history) ? "检测到发布动作记录" : "没有登录、建资源或发布动作"
    }
  ];
  const passed = checks.every((check) => check.passed);
  const markdown = [
    "# 上线材料检查",
    "",
    `结论：${passed ? "材料齐全，可以生成手工发布清单" : "材料不齐，不能进入发布交接"}`,
    "",
    ...checks.map((check) => `- ${check.passed ? "通过" : "未通过"}｜${check.label}：${check.evidence}`),
    "",
    "本步骤只读取工厂内已有证据，没有连接云平台，也没有执行发布。"
  ].join("\n");
  return { passed, checks, markdown };
}

export function buildReleaseHandoff(history: ReleaseHistoryItem[], productName: string) {
  const readiness = findSucceeded(history, "release-readiness");
  const readinessPassed = readiness?.events.some((event) =>
    event.type === "release.readiness.completed" && event.payload.passed === true
  );
  if (!readiness || !readinessPassed) {
    throw new Error("上线检查尚未通过，不能生成发布交接清单");
  }

  const releasePlan = findSucceeded(history, "release-preparation");
  return [
    `# ${productName}｜待人工发布`,
    "",
    "当前状态：发布候选。工厂流程到此停止，尚未上线。",
    "",
    "## 人工发布清单",
    "",
    "1. 产品负责人确认目标平台、账号、资源和可能费用。",
    "2. 人工确认应用、函数、网关或主机的精确 ID，不使用口述名称猜测。",
    "3. 在部署平台 Secret 中配置密钥，不写入 Git、日志或命令文本。",
    "4. 按已确认的上线方案由人工执行构建、上传和发布。",
    "5. 发布后验证 HTTPS、登录、核心闭环、数据恢复、日志和告警。",
    "6. 验收不通过时立即按方案回滚，并保留发布版本与失败证据。",
    "",
    "## 已准备材料",
    "",
    `- 上线方案批次：${releasePlan?.run.id ?? "未登记"}`,
    `- 上线检查批次：${readiness.run.id}`,
    "- 产品候选版本、自动检查和真实验收证据已在生产档案中登记。",
    "",
    "## 明确未执行",
    "",
    "- 未登录任何云平台。",
    "- 未创建或修改任何云资源。",
    "- 未写入正式 Secret 或环境变量。",
    "- 未执行 Git push、上传、部署、发布或回滚。"
  ].join("\n");
}
