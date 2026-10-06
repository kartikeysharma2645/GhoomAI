import { VisionNotConfiguredError } from "../../lib/errors";
import type { AllowedImageMime } from "./validation";

/**
 * Provider-agnostic vision boundary (Phase 8 Prompt 1).
 *
 * The rest of GhoomAI depends only on `VisionProvider.analyzeImage()`.
 * Provider adapters register themselves; no vendor SDK is imported here.
 * The OpenAI adapter is registered by the vision service. A missing
 * provider (or missing credentials) is an explicit configuration error —
 * never a fabricated result.
 */

export interface VisionProviderInput {
  image: Uint8Array;
  mimeType: AllowedImageMime;
}

export interface VisionProviderOutput {
  candidates: Array<{
    name: string;
    type?: string;
    confidence: number;
    reasoning?: string;
    city?: string;
    country?: string;
    visualClues?: string[];
  }>;
  observations: string[];
  warnings: string[];
}

export interface VisionProvider {
  /** Stable adapter name, e.g. "openai-gpt-image". */
  name: string;
  analyzeImage(input: VisionProviderInput): Promise<VisionProviderOutput>;
}

const registry = new Map<string, VisionProvider>();

/** Registers a provider adapter. Future adapters call this on import. */
export function registerVisionProvider(provider: VisionProvider): void {
  registry.set(provider.name, provider);
}

/** Removes a provider adapter (used by tests and future reconfiguration). */
export function unregisterVisionProvider(name: string): void {
  registry.delete(name);
}

/**
 * Resolves the configured vision provider: the most recently registered
 * adapter wins, so explicit registration overrides the default. Throws
 * VisionNotConfiguredError when none is configured — the API layer
 * converts this into an explicit unavailable response.
 */
export function getVisionProvider(): VisionProvider {
  let last: VisionProvider | undefined;
  for (const provider of registry.values()) {
    last = provider;
  }
  if (!last) {
    throw new VisionNotConfiguredError();
  }
  return last;
}

/**
 * Conservative inference contract every future provider adapter must
 * honor. The model describes visual evidence; it never performs live
 * factual verification (that belongs to Search/Maps in Prompt 2).
 */
export const VISION_ANALYSIS_GUIDELINES = [
  "Identify visible landmarks or place candidates only from what is actually visible.",
  "Distinguish observed visual evidence from inference in every candidate.",
  "Do not invent historical facts, dates, or exact locations from weak clues.",
  "Return an empty candidate list rather than guessing when evidence is thin.",
  "Express uncertainty with calibrated confidence scores below 0.6.",
  "Keep visual observations concise and purely descriptive.",
] as const;
