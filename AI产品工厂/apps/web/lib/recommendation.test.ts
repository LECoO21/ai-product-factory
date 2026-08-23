import { describe, expect, it } from "vitest";
import {
  buildRecommendationPrompt,
  parseRecommendation,
  recommendationInputSchema
} from "./recommendation";

describe("recommendation contract", () => {
  it("rejects a minimum budget above the maximum budget", () => {
    expect(() =>
      recommendationInputSchema.parse({
        taste: "想吃辣的",
        dislikes: "不要香菜",
        budget_min: 100,
        budget_max: 20
      })
    ).toThrow("最低预算不能高于最高预算");
  });

  it("keeps taste, dislikes and budget in the model request", () => {
    const prompt = buildRecommendationPrompt({
      taste: "想吃辣的热乎的",
      dislikes: "不要香菜、不要羊肉",
      budget_min: 20,
      budget_max: 40
    });

    expect(prompt).toContain("想吃辣的热乎的");
    expect(prompt).toContain("不要香菜、不要羊肉");
    expect(prompt).toContain("20–40 元");
  });

  it("parses the deterministic dish and reason format", () => {
    expect(
      parseRecommendation("推荐菜品：麻辣香锅单人套餐\n推荐理由：热乎、够辣，并且可以备注不要香菜。")
    ).toEqual({
      dish: "麻辣香锅单人套餐",
      reason: "热乎、够辣，并且可以备注不要香菜。"
    });
  });
});
