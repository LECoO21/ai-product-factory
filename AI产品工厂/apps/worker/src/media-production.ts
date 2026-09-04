import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  imageGenerationCompletionSchema,
  type AgentRuntimeEvent,
  type MediaCapability,
  type MediaKind,
  type MediaProductionStation
} from "@factory/shared";

type MediaProject = { blueprint: { mediaStations?: MediaProductionStation[] | undefined } };

export type VerifiedMediaArtifact = {
  kind: "image";
  itemId: string;
  savedPath: string;
  byteSize: number;
  sha256: string;
};

export type MediaArtifactVerification =
  | { ok: true; artifacts: VerifiedMediaArtifact[] }
  | { ok: false; message: string };

const capabilitiesByKind = (capabilities: MediaCapability[]) =>
  new Map<MediaKind, MediaCapability>(capabilities.map((capability) => [
    capability.kind,
    capability
  ]));

export const mediaCapabilityContext = (
  project: MediaProject,
  capabilities: MediaCapability[]
) => {
  const stations = project.blueprint.mediaStations ?? [];
  if (stations.length === 0) return "本产品未声明图片、音频或 3D 素材生产工位。";
  const byKind = capabilitiesByKind(capabilities);
  return stations.map((station) => {
    const capability = byKind.get(station.kind);
    if (!capability || capability.status === "unavailable") {
      return `${station.title}：不可尝试；${capability?.reason ?? "尚未完成真实能力检测"}`;
    }
    return `${station.title}：可尝试，不代表已生成产物；来源 ${capability.source ?? "Codex"}`;
  }).join("\n");
};

export const unavailableMediaStations = (
  project: MediaProject,
  capabilities: MediaCapability[]
) => {
  const byKind = capabilitiesByKind(capabilities);
  return (project.blueprint.mediaStations ?? []).filter((station) =>
    byKind.get(station.kind)?.status !== "attemptable"
  );
};

const hasRasterImageSignature = (content: Buffer) => {
  if (content.length >= 8 && content.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  )) return true;
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return true;
  }
  if (content.length >= 6) {
    const gif = content.subarray(0, 6).toString("ascii");
    if (gif === "GIF87a" || gif === "GIF89a") return true;
  }
  if (
    content.length >= 12
    && content.subarray(0, 4).toString("ascii") === "RIFF"
    && content.subarray(8, 12).toString("ascii") === "WEBP"
  ) return true;
  if (content.length >= 12 && content.subarray(4, 8).toString("ascii") === "ftyp") {
    return ["avif", "avis", "heic", "heix"].includes(content.subarray(8, 12).toString("ascii"));
  }
  return false;
};

const verifyImageCandidate = (event: AgentRuntimeEvent): VerifiedMediaArtifact | null => {
  if (event.type !== "tool.completed") return null;
  const parsed = imageGenerationCompletionSchema.safeParse(event.payload);
  if (!parsed.success || !isAbsolute(parsed.data.savedPath)) return null;
  try {
    const savedPath = realpathSync(parsed.data.savedPath);
    const metadata = statSync(savedPath);
    if (!metadata.isFile() || metadata.size === 0) return null;
    const content = readFileSync(savedPath);
    if (!hasRasterImageSignature(content)) return null;
    return {
      kind: "image",
      itemId: parsed.data.itemId,
      savedPath,
      byteSize: metadata.size,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  } catch {
    return null;
  }
};

export const verifyRequiredMediaArtifacts = (
  project: MediaProject,
  events: AgentRuntimeEvent[]
): MediaArtifactVerification => {
  const stations = project.blueprint.mediaStations ?? [];
  if (stations.length === 0) return { ok: true, artifacts: [] };

  const verifiedImages = events.flatMap((event) => {
    const artifact = verifyImageCandidate(event);
    return artifact ? [artifact] : [];
  });

  for (const station of stations) {
    if (station.kind === "image" && verifiedImages.length > 0) continue;
    if (station.kind === "image") {
      return {
        ok: false,
        message: "图片素材生产失败：未收到带有可读取真实图片文件的 App Server imageGeneration 完成事件"
      };
    }
    return {
      ok: false,
      message: `${station.title}失败：当前没有可调用、可验真的产物 Adapter`
    };
  }

  return { ok: true, artifacts: verifiedImages };
};
