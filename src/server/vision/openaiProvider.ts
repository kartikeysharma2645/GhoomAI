import { ConfigurationError, UpstreamError } from "../../lib/errors";
import { VISION_ANALYSIS_GUIDELINES, type VisionProvider } from "./providers";
import type { AllowedImageMime } from "./validation";

/**
 * OpenAI vision adapter (Phase 8 Prompt 2).
 *
 * Calls the official OpenAI chat-completions API directly over HTTPS —
 * no vendor SDK is bundled. The API key is read server-side at call
 * time, never logged, and never leaves error messages.
 */

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_VISION_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 800;

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new ConfigurationError(
      "Vision provider credentials are not configured on the server.",
    );
  }
  return key;
}

function getModel(): string {
  const model = process.env.VISION_MODEL;
  return model && model.trim().length > 0 ? model.trim() : DEFAULT_VISION_MODEL;
}

function systemPrompt(): string {
  return [
    "You analyze a travel photo to suggest what place or landmark it may show.",
    ...VISION_ANALYSIS_GUIDELINES,
    "Respond with JSON only, shaped exactly like:",
    '{"candidates":[{"name":"place name","city":"city or null","country":"country or null","category":"one of LANDMARK, BUILDING, MONUMENT, TEMPLE, MUSEUM, NATURAL_SITE, STREET, RESTAURANT, UNKNOWN","confidence":0.0-1.0,"visualClues":["observed detail"]}],"observations":["visible detail"],"uncertainty":"one sentence when unsure","warnings":[]}',
    "Do not include people, and do not infer anything about any person.",
  ].join("\n");
}

interface OpenAIMessage {
  content?: unknown;
}

function extractJsonContent(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new UpstreamError(
      "Vision provider returned an unexpected response shape.",
    );
  }
  const choices = (body as { choices?: unknown }).choices;
  const message = Array.isArray(choices)
    ? (choices[0] as { message?: unknown } | undefined)?.message
    : undefined;
  const content =
    message && typeof message === "object"
      ? (message as OpenAIMessage).content
      : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new UpstreamError(
      "Vision provider returned an unexpected response shape.",
    );
  }
  return content;
}

function mapStatus(status: number): UpstreamError {
  if (status === 401 || status === 403) {
    return new UpstreamError("Vision provider rejected the configured credentials.", status);
  }
  if (status === 429) {
    return new UpstreamError(
      "Vision provider rate limit reached. Try again later.",
      status,
    );
  }
  if (status >= 500) {
    return new UpstreamError("Vision provider is temporarily unavailable.", status);
  }
  return new UpstreamError("Vision provider request failed.", status);
}

export const openaiVisionProvider: VisionProvider = {
  name: "openai-vision",

  async analyzeImage(input: { image: Uint8Array; mimeType: AllowedImageMime }) {
    const apiKey = getApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      const base64 = Buffer.from(input.image).toString("base64");
      res = await fetch(OPENAI_ENDPOINT, {
        method: "POST",
        headers: {
          // Server-side only. The key value never appears in logs,
          // errors, or responses — see error mapping below.
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: getModel(),
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt() },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "What landmark or place does this photo appear to show?",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${base64}` },
                },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new UpstreamError("Vision provider request timed out.");
      }
      throw new UpstreamError("Vision provider is unreachable.");
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw mapStatus(res.status);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError(
        "Vision provider returned an unreadable response.",
      );
    }

    let parsed: {
      candidates?: unknown;
      observations?: unknown;
      uncertainty?: unknown;
      warnings?: unknown;
    };
    try {
      parsed = JSON.parse(extractJsonContent(body)) as typeof parsed;
    } catch {
      throw new UpstreamError(
        "Vision provider returned an unexpected response shape.",
      );
    }
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates.map((c) => {
          const rec = (c ?? {}) as Record<string, unknown>;
          const asString = (v: unknown) =>
            typeof v === "string" ? v : "";
          const asStringArray = (v: unknown) =>
            Array.isArray(v)
              ? v.filter((x): x is string => typeof x === "string")
              : [];
          return {
            name: asString(rec.name),
            type: asString(rec.category),
            confidence:
              typeof rec.confidence === "number" ? rec.confidence : NaN,
            city: asString(rec.city),
            country: asString(rec.country),
            visualClues: asStringArray(rec.visualClues),
          };
        })
      : [];
    const observations = Array.isArray(parsed.observations)
      ? parsed.observations
      : [];
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    if (typeof parsed.uncertainty === "string" && parsed.uncertainty.trim()) {
      warnings.push(parsed.uncertainty);
    }
    return { candidates, observations, warnings };
  },
};
