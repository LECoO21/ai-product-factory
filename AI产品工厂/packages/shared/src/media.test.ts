import { describe, expect, it } from "vitest";
import {
  imageGenerationCompletionSchema,
  mediaCapabilitySchema,
  mediaProductionStationSchema
} from "./media";

describe("mediaProductionStationSchema", () => {
  it("keeps each station bound to its matching real tool capability", () => {
    expect(mediaProductionStationSchema.safeParse({
      id: "image-production",
      kind: "image",
      title: "图片素材生产",
      requiredToolCapability: "image-generation",
      requiredChecks: {
        implementation: ["image-tool-capability"],
        acceptance: ["image-human-review"]
      }
    }).success).toBe(true);

    expect(mediaProductionStationSchema.safeParse({
      id: "image-production",
      kind: "image",
      title: "图片素材生产",
      requiredToolCapability: "model3d-generation",
      requiredChecks: {
        implementation: ["image-tool-capability"],
        acceptance: ["image-human-review"]
      }
    }).success).toBe(false);
  });

  it("distinguishes a preflight attempt from a verified media artifact", () => {
    expect(mediaCapabilitySchema.safeParse({
      kind: "image",
      status: "attemptable",
      source: "codex-app-server:image-generation+codex-skill:imagegen",
      reason: "App Server 报告图片能力且 imagegen Skill 已启用；当前工位仍需真实产物验真"
    }).success).toBe(true);
    expect(mediaCapabilitySchema.safeParse({
      kind: "image",
      status: "available",
      source: "anything",
      reason: "不应允许用预检状态声明产物可用"
    }).success).toBe(false);
  });

  it("requires an App Server imageGeneration completion candidate to carry a saved path", () => {
    expect(imageGenerationCompletionSchema.safeParse({
      sourceItemType: "imageGeneration",
      lifecycle: "item/completed",
      itemId: "image-1",
      generationSucceeded: true,
      savedPath: "/tmp/image-1.png"
    }).success).toBe(true);
    expect(imageGenerationCompletionSchema.safeParse({
      sourceItemType: "imageGeneration",
      lifecycle: "item/completed",
      itemId: "image-1",
      generationSucceeded: true,
      savedPath: null
    }).success).toBe(false);
  });
});
