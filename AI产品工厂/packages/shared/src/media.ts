import { z } from "zod";

export const MEDIA_KINDS = ["image", "audio", "model3d"] as const;
export const MEDIA_CAPABILITY_STATUSES = ["attemptable", "unavailable"] as const;

export const mediaKindSchema = z.enum(MEDIA_KINDS);
export const mediaCapabilityStatusSchema = z.enum(MEDIA_CAPABILITY_STATUSES);

export const mediaCapabilitySchema = z.object({
  kind: mediaKindSchema,
  status: mediaCapabilityStatusSchema,
  source: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1)
});

export const imageGenerationCompletionSchema = z.object({
  sourceItemType: z.literal("imageGeneration"),
  lifecycle: z.literal("item/completed"),
  itemId: z.string().trim().min(1),
  generationSucceeded: z.literal(true),
  savedPath: z.string().trim().min(1)
});

const stationChecksSchema = z.object({
  implementation: z.array(z.string().min(1)).min(1),
  acceptance: z.array(z.string().min(1)).min(1)
});

export const mediaProductionStationSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.literal("image-production"),
    kind: z.literal("image"),
    title: z.literal("图片素材生产"),
    requiredToolCapability: z.literal("image-generation"),
    requiredChecks: stationChecksSchema
  }),
  z.object({
    id: z.literal("audio-production"),
    kind: z.literal("audio"),
    title: z.literal("音频素材生产"),
    requiredToolCapability: z.literal("audio-generation"),
    requiredChecks: stationChecksSchema
  }),
  z.object({
    id: z.literal("model3d-production"),
    kind: z.literal("model3d"),
    title: z.literal("3D 素材生产"),
    requiredToolCapability: z.literal("model3d-generation"),
    requiredChecks: stationChecksSchema
  })
]);

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaCapabilityStatus = z.infer<typeof mediaCapabilityStatusSchema>;
export type MediaCapability = z.infer<typeof mediaCapabilitySchema>;
export type ImageGenerationCompletion = z.infer<typeof imageGenerationCompletionSchema>;
export type MediaProductionStation = z.infer<typeof mediaProductionStationSchema>;
