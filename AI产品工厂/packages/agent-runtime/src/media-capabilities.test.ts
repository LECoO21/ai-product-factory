import { describe, expect, it } from "vitest";
import { detectMediaCapabilities, type CodexProviderCapabilities } from "./media-capabilities";

const provider = (imageGeneration: boolean): CodexProviderCapabilities => ({
  imageGeneration,
  namespaceTools: true,
  webSearch: true
});

describe("detectMediaCapabilities", () => {
  it("marks image generation only attemptable when both App Server and imagegen agree", () => {
    expect(detectMediaCapabilities(
      [{ name: "imagegen", enabled: true }],
      provider(true),
      {}
    )).toEqual([
      expect.objectContaining({
        kind: "image",
        status: "attemptable",
        source: "codex-app-server:image-generation+codex-skill:imagegen"
      }),
      expect.objectContaining({ kind: "audio", status: "unavailable", source: null }),
      expect.objectContaining({ kind: "model3d", status: "unavailable", source: null })
    ]);
  });

  it("fails closed when a Skill exists but App Server does not report image generation", () => {
    expect(detectMediaCapabilities(
      [{ name: "imagegen", enabled: true }],
      provider(false),
      {}
    )[0]).toEqual(expect.objectContaining({
      kind: "image",
      status: "unavailable",
      source: null
    }));
  });

  it("never treats arbitrary FACTORY_MEDIA strings or Skills as real audio and 3D Adapters", () => {
    const capabilities = detectMediaCapabilities(
      [
        { name: "tts", enabled: true },
        { name: "blender", enabled: true }
      ],
      provider(false),
      {
        FACTORY_MEDIA_IMAGE_TOOL: "pretend-image-command",
        FACTORY_MEDIA_AUDIO_TOOL: "pretend-audio-command",
        FACTORY_MEDIA_3D_TOOL: "pretend-3d-command"
      }
    );

    expect(capabilities.every((capability) => capability.status === "unavailable")).toBe(true);
    expect(capabilities.every((capability) => capability.source === null)).toBe(true);
    expect(capabilities.map((capability) => capability.reason).join(" ")).toContain("已忽略未绑定 Adapter");
  });
});
