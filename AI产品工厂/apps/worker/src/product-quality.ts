export type ProductQualityCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ProductQualityReport = {
  passed: boolean;
  checks: ProductQualityCheck[];
  internalApiPaths: string[];
};

const makeCheck = (
  id: string,
  label: string,
  passed: boolean,
  passDetail: string,
  failDetail: string
): ProductQualityCheck => ({ id, label, passed, detail: passed ? passDetail : failDetail });

const unique = <T>(values: T[]) => [...new Set(values)];

export function inspectProductHtml(html: string): ProductQualityReport {
  const hasDocumentStructure =
    /^\s*<!doctype html>/i.test(html) && /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html);
  const hasInteractiveControl =
    /<(?:button|input|textarea|select|canvas)[\s>]/i.test(html) || /\srole=["']button["']/i.test(html);
  const hasInteractionBinding =
    /addEventListener\s*\(/.test(html) || /\son(?:click|submit|change|input)\s*=/i.test(html);
  const externalResourcePattern =
    /<(?:script|img|link|iframe|audio|video|source)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i;
  const externalCssPattern = /url\(\s*["']?(?:https?:)?\/\//i;
  const hasExternalResources = externalResourcePattern.test(html) || externalCssPattern.test(html);
  const embeddedSecretPatterns = [
    /\bsk-[a-z0-9_-]{16,}\b/i,
    /\bapi[_-]?key\b\s*[:=]\s*["'][^"']{8,}["']/i,
    /\bauthorization\b\s*[:=]\s*["']bearer\s+[a-z0-9._-]{12,}["']/i
  ];
  const hasEmbeddedSecret = embeddedSecretPatterns.some((pattern) => pattern.test(html));
  const internalApiPaths = unique(
    [...html.matchAll(/\bfetch\s*\(\s*["'](\/api\/[^"']+)["']/g)].map((match) => match[1]!)
  );

  const checks = [
    makeCheck(
      "document-structure",
      "HTML 文档结构",
      hasDocumentStructure,
      "DOCTYPE、html 和 body 结构完整",
      "缺少完整的 DOCTYPE、html 或 body 结构"
    ),
    makeCheck(
      "interactive-controls",
      "核心交互控件",
      hasInteractiveControl,
      "页面包含可操作控件",
      "页面没有按钮、输入框、选择器或画布等核心控件"
    ),
    makeCheck(
      "interaction-binding",
      "交互逻辑",
      hasInteractionBinding,
      "页面已绑定用户操作逻辑",
      "页面没有发现可执行的用户操作逻辑"
    ),
    makeCheck(
      "no-external-resources",
      "无外部页面资源",
      !hasExternalResources,
      "脚本、样式和图片均不依赖外部网址",
      "发现外部脚本、样式、图片或媒体资源"
    ),
    makeCheck(
      "no-embedded-secrets",
      "无前端密钥",
      !hasEmbeddedSecret,
      "未发现疑似 API Key 或 Bearer Token",
      "发现疑似写入 HTML 的 API Key 或 Bearer Token"
    )
  ];

  return {
    passed: checks.every((check) => check.passed),
    checks,
    internalApiPaths
  };
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function runProductQuality(
  html: string,
  _options: { origin: string; fetchImpl?: FetchImplementation }
): Promise<ProductQualityReport> {
  const staticReport = inspectProductHtml(html);
  const checks = [...staticReport.checks];

  return {
    passed: checks.every((check) => check.passed),
    checks,
    internalApiPaths: staticReport.internalApiPaths
  };
}

export function formatProductQualityReport(report: ProductQualityReport) {
  const passedCount = report.checks.filter((check) => check.passed).length;
  const lines = report.checks.map(
    (check) => `- ${check.passed ? "通过" : "失败"}｜${check.label}：${check.detail}`
  );
  return [
    "# 自动检查结果",
    "",
    report.passed ? "结论：自动检查通过，可以进入人工验收。" : "结论：自动检查失败，不能进入人工验收。",
    `检查项：${passedCount}/${report.checks.length} 通过`,
    "",
    ...lines
  ].join("\n");
}
