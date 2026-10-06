import { z } from "zod";

/**
 * Phase 8 Prompt 1 vision-analysis domain contract.
 *
 * A VisionAnalysisResult describes what an image APPEARS to show, with
 * uncertainty explicit. It is never a verified location claim — live
 * factual verification belongs to the Search/Maps layer (Prompt 2).
 */

export const VISION_STATUSES = [
  "IDENTIFIED",
  "LIKELY",
  "UNCERTAIN",
  "UNIDENTIFIED",
  "ERROR",
] as const;

export type VisionStatus = (typeof VISION_STATUSES)[number];

export const VISION_SUBJECT_TYPES = [
  "LANDMARK",
  "BUILDING",
  "MONUMENT",
  "TEMPLE",
  "MUSEUM",
  "NATURAL_SITE",
  "STREET",
  "RESTAURANT",
  "UNKNOWN",
] as const;

export type VisionSubjectType = (typeof VISION_SUBJECT_TYPES)[number];

export const visionCandidateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(VISION_SUBJECT_TYPES).default("UNKNOWN"),
  /** Calibrated 0–1 estimate, never a claim of certainty. */
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});

export type VisionCandidate = z.infer<typeof visionCandidateSchema>;

export const visionAnalysisResultSchema = z.object({
  analysisId: z.string().min(1).max(100),
  analyzedAt: z.string(),
  status: z.enum(VISION_STATUSES),
  subject: z
    .object({
      description: z.string().max(500).optional(),
      dominantType: z.enum(VISION_SUBJECT_TYPES).optional(),
    })
    .optional(),
  candidates: z.array(visionCandidateSchema).max(10),
  visualObservations: z.array(z.string().max(300)).max(20),
  warnings: z.array(z.string().max(300)),
});

export type VisionAnalysisResult = z.infer<typeof visionAnalysisResultSchema>;
