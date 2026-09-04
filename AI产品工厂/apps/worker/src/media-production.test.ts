import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRuntimeEvent, MediaProductionStation } from "@factory/shared";
import {
  mediaCapabilityContext,
  unavailableMediaStations,
  verifyRequiredMediaArtifacts
} from "./media-production";

const imageStation: MediaProductionStation = {
  id: "image-production",
  kind: "image",
  title: "图片素材生产",
  requiredToolCapability: "image-generation",
  requiredChecks: {
    implementation: ["image-artifact-integrity"],
    acceptance: ["image-human-review"]
  }
};

const projectWith = (mediaStations: MediaProductionStation[]) => ({
  blueprint: { mediaStations }
});

const event = (type: AgentRuntimeEvent["type"], payload: Record<string, unknown>): AgentRuntimeEvent => ({
  type,
  payload,
  occurredAt: "2026-09-02T08:00:00.000Z"
});

describe("media production truthfulness", () => {
  it("does not affect a normal product that declares no media station", () => {
    expect(verifyRequiredMediaArtifacts(projectWith([]), [
      event("agent.completed", {})
    ])).toEqual({ ok: true, artifacts: [] });
  });

  it("describes image preflight as attemptable rather than already available", () => {
    const capabilities = [{
      kind: "image" as const,
      status: "attemptable" as const,
      source: "codex-app-server:image-generation+codex-skill:imagegen",
      reason: "需要产物验真"
    }];
    expect(mediaCapabilityContext(projectWith([imageStation]), capabilities)).toContain("可尝试，不代表已生成产物");
    expect(unavailableMediaStations(projectWith([imageStation]), capabilities)).toEqual([]);
  });

  it("rejects text that merely claims an image was generated", () => {
    expect(verifyRequiredMediaArtifacts(projectWith([imageStation]), [
      event("text.delta", { delta: "图片已经生成完成" }),
      event("agent.completed", {})
    ])).toEqual(expect.objectContaining({ ok: false }));
  });

  it("rejects imageGeneration completion when savedPath cannot be verified", () => {
    expect(verifyRequiredMediaArtifacts(projectWith([imageStation]), [
      event("tool.completed", {
        sourceItemType: "imageGeneration",
        lifecycle: "item/completed",
        itemId: "image-1",
        generationSucceeded: true,
        savedPath: "/tmp/does-not-exist-naxe-image.png"
      })
    ])).toEqual(expect.objectContaining({ ok: false }));
  });

  it("accepts an image only after checking the App Server event and real file bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-image-proof-"));
    const savedPath = join(directory, "generated.png");
    writeFileSync(savedPath, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]));

    const verification = verifyRequiredMediaArtifacts(projectWith([imageStation]), [
      event("tool.completed", {
        sourceItemType: "imageGeneration",
        lifecycle: "item/completed",
        itemId: "image-1",
        generationSucceeded: true,
        savedPath
      })
    ]);

    expect(verification).toEqual({
      ok: true,
      artifacts: [expect.objectContaining({
        kind: "image",
        itemId: "image-1",
        savedPath: realpathSync(savedPath),
        byteSize: 16,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })]
    });
  });
});
