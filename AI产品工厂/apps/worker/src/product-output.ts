import { extractProductPrototypeHtml, type ProductionStage } from "@factory/shared";

export const isHarnessValidationObjective = (objective: string) =>
  /最小\s*Harness|Factory\s+Harness|Harness\s*验证/i.test(objective);

export function getProductOutputArtifact(
  stage: ProductionStage,
  output: string,
  productName: string,
) {
  if (stage !== "stage-design" && stage !== "implementation") return null;
  const content = extractProductPrototypeHtml(output);
  if (!content) {
    throw new Error(
      stage === "stage-design"
        ? "开发计划缺少当前产品的基础 HTML，请重新生成"
        : "制作结果缺少当前产品的可运行 HTML，请重新制作"
    );
  }
  return {
    kind: "product-prototype-html",
    title: `${productName}｜${stage === "stage-design" ? "基础 HTML" : "第一版产品"}`,
    mediaType: "text/html",
    content
  };
}
