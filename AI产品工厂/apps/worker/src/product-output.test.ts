import { describe, expect, it } from "vitest";
import { getProductOutputArtifact, isHarnessValidationObjective } from "./product-output";

describe("product implementation routing", () => {
  it("uses the Harness fixture only for an explicit Harness validation objective", () => {
    expect(isHarnessValidationObjective("验证最小 Harness 闭环")).toBe(true);
    expect(isHarnessValidationObjective("根据开发计划制作第一版可运行产品")).toBe(false);
  });

  it("registers a runnable product artifact for a normal implementation", () => {
    const artifact = getProductOutputArtifact(
      "implementation",
      [
        "制作结果",
        "<!-- PRODUCT_PROTOTYPE_START -->",
        "<!doctype html><html><body><button>开始</button></body></html>",
        "<!-- PRODUCT_PROTOTYPE_END -->"
      ].join("\n"),
      "测试产品"
    );

    expect(artifact).toEqual(expect.objectContaining({
      kind: "product-prototype-html",
      title: "测试产品｜第一版产品"
    }));
  });
});
