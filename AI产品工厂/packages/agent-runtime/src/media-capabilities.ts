import type { MediaCapability, MediaKind } from "@factory/shared";
import type { CodexProviderCapabilities, CodexSkill } from "./codex-account";

export type MediaCapabilityKind = MediaKind;
export type { MediaCapability } from "@factory/shared";

export type { CodexProviderCapabilities } from "./codex-account";

const imageSkillNames = new Set(["imagegen", "image-generation"]);

const environmentKeys: Record<MediaCapabilityKind, string> = {
  image: "FACTORY_MEDIA_IMAGE_TOOL",
  audio: "FACTORY_MEDIA_AUDIO_TOOL",
  model3d: "FACTORY_MEDIA_3D_TOOL"
};

const configuredStringWasIgnored = (
  kind: MediaCapabilityKind,
  environment: NodeJS.ProcessEnv
) => Boolean(environment[environmentKeys[kind]]?.trim());

const unavailable = (kind: MediaCapabilityKind, reason: string): MediaCapability => ({
  kind,
  status: "unavailable",
  source: null,
  reason
});

/**
 * This is preflight discovery, not proof that a station produced an artifact.
 * Environment strings never establish executable capability. Audio and 3D stay
 * unavailable until the factory owns a concrete Adapter that it can invoke and
 * verify; no such Adapter exists in the current runtime.
 */
export const detectMediaCapabilities = (
  skills: CodexSkill[],
  providerCapabilities: CodexProviderCapabilities | null,
  environment: NodeJS.ProcessEnv = process.env
): MediaCapability[] => {
  const imageSkill = skills.find((candidate) =>
    candidate.enabled && imageSkillNames.has(candidate.name.trim().toLowerCase())
  );

  let image: MediaCapability;
  if (providerCapabilities?.imageGeneration === true && imageSkill) {
    image = {
      kind: "image",
      status: "attemptable",
      source: `codex-app-server:image-generation+codex-skill:${imageSkill.name}`,
      reason: "App Server 报告图片生成能力且 imagegen Skill 已启用；当前工位仍必须验证真实图片产物"
    };
  } else if (providerCapabilities?.imageGeneration !== true) {
    image = unavailable(
      "image",
      configuredStringWasIgnored("image", environment)
        ? "已忽略未绑定 Adapter 的图片工具配置；App Server 未报告图片生成能力"
        : "App Server 未报告图片生成能力"
    );
  } else {
    image = unavailable("image", "App Server 支持图片生成，但未发现已启用的 imagegen Skill");
  }

  const missingAdapter = (kind: "audio" | "model3d", label: string) => unavailable(
    kind,
    configuredStringWasIgnored(kind, environment)
      ? `已忽略未绑定 Adapter 的${label}工具配置；当前运行时没有可调用、可验真的${label} Adapter`
      : `当前运行时没有可调用、可验真的${label} Adapter`
  );

  return [image, missingAdapter("audio", "音频"), missingAdapter("model3d", "3D")];
};
