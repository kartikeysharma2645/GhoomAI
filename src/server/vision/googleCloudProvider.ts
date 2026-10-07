import { ConfigurationError, UpstreamError } from "../../lib/errors";
import type {
  VisionProvider,
  VisionProviderInput,
  VisionProviderOutput,
} from "./providers";
import type { AllowedImageMime } from "./validation";

/**
 * Google Cloud Vision landmark adapter (Vision Companion provider).
 *
 * Calls the official `images:annotate` LANDMARK_DETECTION capability via
 * the official `@google-cloud/vision` SDK (`ImageAnnotatorClient`), using
 * in-memory image bytes — never Cloud Storage, never persisted. Auth uses
 * Application Default Credentials resolved server-side by the SDK; no
 * credential ever leaves this module, and none is logged or returned.
 *
 * Output is mapped into the provider-agnostic contract only: landmark
 * description → candidate name, API score → calibrated 0–1 confidence,
 * ranked order preserved. No city/country is inferred (the API returns
 * coordinates, not place names — inventing them would be fabrication).
 * An empty annotation list yields zero candidates, which the service
 * honestly reports as UNIDENTIFIED.
 */

export const GOOGLE_VISION_PROVIDER_NAME = "google-cloud-vision";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CANDIDATES = 10;

/** Minimal structural view of the SDK client, so tests can inject fakes. */
export interface LandmarkDetectionClient {
  landmarkDetection(request: unknown): Promise<unknown>;
}

export interface GoogleVisionDeps {
  createClient?: () => LandmarkDetectionClient;
}

/** Values both `VISION_PROVIDER` and the enable flag accept as "on". */
function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * Whether the Google Cloud Vision adapter should register. Explicit
 * `VISION_PROVIDER=google` always opts in; otherwise it opts in only with
 * the explicit `GOOGLE_CLOUD_VISION_ENABLED` flag — an unconfigured
 * machine must keep the honest VISION_NOT_CONFIGURED behavior rather than
 * registering an adapter whose credentials cannot exist.
 */
export function isGoogleCloudVisionEnabled(): boolean {
  const preference = (process.env.VISION_PROVIDER ?? "").trim().toLowerCase();
  if (preference === "google") return true;
  if (preference !== "") return false;
  return isTruthyFlag(process.env.GOOGLE_CLOUD_VISION_ENABLED);
}

interface RawLandmark {
  description?: unknown;
  score?: unknown;
}

/**
 * Normalizes one Landmark Detection annotation batch into provider
 * candidates. Pure: unknown shapes, blank names, and non-finite or
 * out-of-range scores are dropped (the API documents 0–1; anything else
 * is malformed, not a low-confidence sighting). Ranking order preserved.
 */
export function toProviderCandidates(
  annotations: unknown,
): VisionProviderOutput["candidates"] {
  if (!Array.isArray(annotations)) return [];
  const out: VisionProviderOutput["candidates"] = [];
  for (const entry of annotations) {
    const rec = (
      entry && typeof entry === "object" ? entry : {}
    ) as RawLandmark;
    const name =
      typeof rec.description === "string" ? rec.description.trim() : "";
    const score = typeof rec.score === "number" ? rec.score : NaN;
    if (!name || !Number.isFinite(score) || score < 0 || score > 1) continue;
    out.push({
      name: name.slice(0, 200),
      type: "LANDMARK",
      confidence: score,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function errorAnnotationsOf(response: unknown): { code?: unknown } | null {
  if (!response || typeof response !== "object") return null;
  const err = (response as { error?: unknown }).error;
  return err && typeof err === "object"
    ? (err as { code?: unknown })
    : null;
}

/** Maps Google API failures onto the shared error taxonomy. Never leaks details. */
export function mapGoogleVisionError(err: unknown): UpstreamError {
  const code =
    err && typeof err === "object"
      ? (err as { code?: unknown }).code
      : undefined;
  const detailsText =
    err && typeof err === "object" &&
    typeof (err as { details?: unknown }).details === "string"
      ? ((err as { details: string }).details as string)
      : "";
  if (/billing/i.test(detailsText)) {
    return new UpstreamError(
      "Vision provider billing is not enabled for the configured Google Cloud project.",
      403,
    );
  }
  if (code === 16 || code === "UNAUTHENTICATED") {
    return new UpstreamError(
      "Vision provider rejected the configured credentials.",
      401,
    );
  }
  if (code === 7 || code === "PERMISSION_DENIED") {
    return new UpstreamError(
      "Vision provider rejected the configured credentials.",
      403,
    );
  }
  if (code === 8 || code === "RESOURCE_EXHAUSTED") {
    return new UpstreamError(
      "Vision provider rate limit reached. Try again later.",
      429,
    );
  }
  return new UpstreamError("Vision provider request failed.");
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UpstreamError("Vision provider request timed out.")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function defaultCreateClient(): Promise<LandmarkDetectionClient> {
  let sdk: {
    ImageAnnotatorClient: new () => LandmarkDetectionClient;
  };
  try {
    sdk = (await import("@google-cloud/vision")) as unknown as typeof sdk;
  } catch {
    throw new ConfigurationError(
      "Google Cloud Vision support is not installed on the server.",
    );
  }
  return new sdk.ImageAnnotatorClient();
}

export function createGoogleCloudVisionProvider(
  deps: GoogleVisionDeps = {},
): VisionProvider {
  let cached: LandmarkDetectionClient | undefined;
  async function client(): Promise<LandmarkDetectionClient> {
    if (!cached) {
      cached = deps.createClient ? deps.createClient() : await defaultCreateClient();
    }
    return cached;
  }

  return {
    name: GOOGLE_VISION_PROVIDER_NAME,

    async analyzeImage(input: {
      image: Uint8Array;
      mimeType: AllowedImageMime;
    }): Promise<VisionProviderOutput> {
      return runAnalysis(input, client);
    },
  };
}

async function runAnalysis(
  input: VisionProviderInput,
  getClient: () => Promise<LandmarkDetectionClient>,
): Promise<VisionProviderOutput> {
  let raw: unknown;
  try {
    const sdkClient = await getClient();
    raw = await withTimeout(
      sdkClient.landmarkDetection({
        image: { content: Buffer.from(input.image) },
      }),
    );
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw mapGoogleVisionError(err);
  }

  const response = Array.isArray(raw) ? raw[0] : raw;
  const embedded = errorAnnotationsOf(response);
  if (embedded) throw mapGoogleVisionError(embedded);

  const annotations =
    response && typeof response === "object"
      ? (response as { landmarkAnnotations?: unknown }).landmarkAnnotations
      : undefined;
  return {
    candidates: toProviderCandidates(annotations),
    observations: [],
    warnings: [],
  };
}

/** Shared singleton wired into the provider registry by the service. */
export const googleCloudVisionProvider: VisionProvider =
  createGoogleCloudVisionProvider();
