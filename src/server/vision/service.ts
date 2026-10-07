import { z } from "zod";
import { ConfigurationError, UpstreamError } from "../../lib/errors";
import {
  visionAnalysisResultSchema,
  VISION_SUBJECT_TYPES,
  type VisionAnalysisResult,
  type VisionCandidate,
} from "./types";

export type { VisionAnalysisResult, VisionCandidate };
import { validateImageInput } from "./validation";
import { getVisionProvider, registerVisionProvider } from "./providers";
import { openaiVisionProvider } from "./openaiProvider";
import {
  googleCloudVisionProvider,
  isGoogleCloudVisionEnabled,
} from "./googleCloudProvider";

// Provider registration is deterministic and credential-gated:
// - `VISION_PROVIDER=openai` registers OpenAI only (when its key is set).
// - `VISION_PROVIDER=google` registers Google Cloud Vision only.
// - Unset selects automatically: OpenAI when its key is present, plus
//   Google Cloud Vision when explicitly enabled (currently the only way to
//   detect intent to use ADC credentials without making a live call).
// Registration order puts Google last so it wins ties — landmark
// identification is this feature's purpose. With nothing configured the
// registry stays empty and vision calls fail with an explicit
// VisionNotConfiguredError — never a fabricated result. Tests may register
// fakes explicitly.
const visionPreference = (process.env.VISION_PROVIDER ?? "").trim().toLowerCase();
if (
  (visionPreference === "" || visionPreference === "openai") &&
  typeof process.env.OPENAI_API_KEY === "string" &&
  process.env.OPENAI_API_KEY.trim().length > 0
) {
  registerVisionProvider(openaiVisionProvider);
}
if (isGoogleCloudVisionEnabled()) {
  registerVisionProvider(googleCloudVisionProvider);
}

/**
 * Vision analysis service (Phase 8 Prompt 1).
 *
 * Validates the upload, resolves the configured provider, and normalizes
 * the response into a VisionAnalysisResult. Provider payloads are never
 * forwarded: unknown fields are dropped, unknown subject types fall back
 * to UNKNOWN, and malformed provider output becomes a safe upstream
 * error. With no provider configured, callers receive an explicit
 * ConfigurationError.
 */

/** Top-candidate confidence at or above this reads as identified. */
export const IDENTIFIED_MIN_CONFIDENCE = 0.85;
/** Top-candidate confidence at or above this reads as likely. */
export const LIKELY_MIN_CONFIDENCE = 0.6;

const providerOutputSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            name: z.unknown(),
            type: z.unknown(),
            confidence: z.unknown(),
            reasoning: z.unknown(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    observations: z.array(z.unknown()).optional().default([]),
    warnings: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

function newAnalysisId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `va_${crypto.randomUUID()}`;
  }
  return `va_${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000)}`;
}

function toCandidate(raw: {
  name?: unknown;
  type?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  city?: unknown;
  country?: unknown;
  visualClues?: unknown;
}): VisionCandidate | null {
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return null;
  }
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
    return null;
  }
  const knownType =
    typeof raw.type === "string" &&
    (VISION_SUBJECT_TYPES as readonly string[]).includes(raw.type)
      ? (raw.type as VisionCandidate["type"])
      : "UNKNOWN";
  const clues = Array.isArray(raw.visualClues)
    ? raw.visualClues.filter((c): c is string => typeof c === "string").slice(0, 5)
    : [];
  return {
    name: raw.name.slice(0, 200),
    type: knownType,
    confidence: raw.confidence,
    ...(typeof raw.reasoning === "string"
      ? { reasoning: raw.reasoning.slice(0, 500) }
      : clues.length > 0
        ? { reasoning: clues.join("; ").slice(0, 500) }
        : {}),
    ...(typeof raw.city === "string" && raw.city.trim()
      ? { city: raw.city.slice(0, 100) }
      : {}),
    ...(typeof raw.country === "string" && raw.country.trim()
      ? { country: raw.country.slice(0, 100) }
      : {}),
  };
}

function toObservation(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0
    ? raw.slice(0, 300)
    : null;
}

function deriveStatus(
  candidates: VisionCandidate[],
): VisionAnalysisResult["status"] {
  if (candidates.length === 0) return "UNIDENTIFIED";
  const top = Math.max(...candidates.map((c) => c.confidence));
  if (top >= IDENTIFIED_MIN_CONFIDENCE) return "IDENTIFIED";
  if (top >= LIKELY_MIN_CONFIDENCE) return "LIKELY";
  return "UNCERTAIN";
}

export async function analyzeImage(input: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  sizeBytes?: number;
}): Promise<VisionAnalysisResult> {
  const image = validateImageInput(input);
  const provider = getVisionProvider();

  let raw: unknown;
  try {
    raw = await provider.analyzeImage({
      image: image.bytes,
      mimeType: image.mimeType,
    });
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    throw new UpstreamError("Vision provider request failed.");
  }

  const shaped = providerOutputSchema.safeParse(raw);
  if (!shaped.success) {
    throw new UpstreamError(
      "Vision provider returned an unexpected response shape.",
    );
  }
  const candidates = shaped.data.candidates
    .map(toCandidate)
    .filter((c): c is VisionCandidate => c !== null)
    .slice(0, 10);
  const visualObservations = shaped.data.observations
    .map(toObservation)
    .filter((o): o is string => o !== null)
    .slice(0, 20);
  const warnings = shaped.data.warnings
    .map(toObservation)
    .filter((w): w is string => w !== null);

  return visionAnalysisResultSchema.parse({
    analysisId: newAnalysisId(),
    analyzedAt: new Date().toISOString(),
    status: deriveStatus(candidates),
    candidates,
    visualObservations,
    warnings,
  });
}
