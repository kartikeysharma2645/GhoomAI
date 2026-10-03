import {
  ConfigurationError,
  UpstreamError,
  type UpstreamErrorDetails,
  ValidationError,
} from "../../../lib/errors";
import {
  SERPAPI_BASE_URL,
  mapsSearchParamsSchema,
  normalizeMapsPlaces,
  searchParamsSchema,
  serpApiMapsResponseSchema,
  serpApiSearchResponseSchema,
  type NormalizedMapsResponse,
  type NormalizedSearchResponse,
} from "./types";

const SEARCH_PATH = "/search.json";
const REQUEST_TIMEOUT_MS = 15_000;
/** City-level map zoom, sent when `location` is used without an explicit zoom. */
const DEFAULT_MAPS_ZOOM = 13;

/**
 * Reads the SerpApi key from the server environment.
 * The key is NEVER accepted from client input and NEVER logged or returned.
 */
function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key || key.trim().length === 0) {
    throw new ConfigurationError("SerpApi is not configured on the server.");
  }
  return key;
}

function mapStatusToError(
  status: number,
  details?: UpstreamErrorDetails,
): UpstreamError {
  if (status === 401 || status === 403) {
    return new UpstreamError(
      "Search provider rejected the configured API key.",
      status,
      details,
    );
  }
  if (status === 429) {
    return new UpstreamError(
      "Search provider rate limit reached. Try again later.",
      status,
      details,
    );
  }
  if (status >= 500) {
    return new UpstreamError(
      "Search provider is temporarily unavailable.",
      status,
      details,
    );
  }
  return new UpstreamError("Search provider request failed.", status, details);
}

/**
 * Redacts the API key value from provider text and caps its length.
 * The key value is known only here, server-side — redaction is exact,
 * and the result never contains request URLs.
 */
function sanitizeProviderMessage(message: string, apiKey: string): string {
  return message.split(apiKey).join("[REDACTED]").slice(0, 300);
}

/**
 * Server-side gateway for SerpApi Search Engine APIs.
 *
 * Usage:
 *   const client = new SerpApiClient(); // throws ConfigurationError if key missing
 *   const results = await client.search({ engine: "google", query: "..." });
 *   const places = await client.searchMaps({ query: "...", location: "..." });
 *
 * Design notes:
 * - All SerpApi traffic flows through this class; no raw fetch calls elsewhere.
 * - `search` (Google Search) and `searchMaps` (Google Maps) share one private
 *   transport; only validation/normalization differ per engine.
 * - Error messages never include the request URL (it carries the API key).
 * - Responses are validated with Zod and normalized before leaving this boundary.
 */
export class SerpApiClient {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getSerpApiKey();
  }

  /**
   * Reads a safe diagnostic from a failed HTTP response: the status plus a
   * redacted provider `error` field when the body is JSON. Never throws and
   * never includes the request URL or the API key value.
   */
  private async readErrorDetails(res: Response): Promise<UpstreamErrorDetails> {
    const details: UpstreamErrorDetails = { httpStatus: res.status };
    try {
      const body = (await res.json()) as unknown;
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        details.providerError = sanitizeProviderMessage(
          (body as { error: string }).error,
          this.apiKey,
        );
      }
    } catch {
      // Non-JSON or unreadable body: status alone is the diagnostic.
    }
    return details;
  }

  /**
   * Shared transport: executes the request, maps failures to safe errors,
   * and returns the parsed JSON payload. Never includes the URL/key in errors.
   */
  private async requestJson(query: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${SERPAPI_BASE_URL}${SEARCH_PATH}?${query.toString()}`, {
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new UpstreamError("Search provider request timed out.");
      }
      throw new UpstreamError("Search provider is unreachable.");
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw mapStatusToError(res.status, await this.readErrorDetails(res));
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new UpstreamError(
        "Search provider returned an unreadable response.",
      );
    }

    // SerpApi reports engine-level failures (e.g. bad key, bad engine)
    // via an "error" field. Map to a generic message — never forward raw payloads.
    if (
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error: unknown }).error === "string"
    ) {
      const providerMessage = (
        json as { error: string }
      ).error.toLowerCase();
      if (
        providerMessage.includes("api key") ||
        providerMessage.includes("invalid") ||
        providerMessage.includes("unauthorized")
      ) {
        throw new UpstreamError(
          "Search provider rejected the configured API key.",
          undefined,
          {
            providerError: sanitizeProviderMessage(
              (json as { error: string }).error,
              this.apiKey,
            ),
          },
        );
      }
      throw new UpstreamError("Search provider reported an error.", undefined, {
        providerError: sanitizeProviderMessage(
          (json as { error: string }).error,
          this.apiKey,
        ),
      });
    }

    return json;
  }

  async search(input: unknown): Promise<NormalizedSearchResponse> {
    const parsed = searchParamsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid search parameters.");
    }
    const params = parsed.data;

    const qs = new URLSearchParams({
      engine: params.engine,
      q: params.query,
      api_key: this.apiKey,
      num: String(params.num),
    });
    if (params.location) qs.set("location", params.location);
    if (params.language) qs.set("hl", params.language);
    if (params.country) qs.set("gl", params.country);

    const json = await this.requestJson(qs);

    const validated = serpApiSearchResponseSchema.safeParse(json);
    if (!validated.success) {
      throw new UpstreamError(
        "Search provider returned an unexpected response shape.",
      );
    }

    const results = validated.data.organic_results.map((item, index) => ({
      position: item.position ?? index + 1,
      title: item.title ?? "",
      link: item.link ?? "",
      snippet: item.snippet ?? "",
      ...(item.displayed_link ? { displayedLink: item.displayed_link } : {}),
    }));

    return {
      engine: params.engine,
      query: params.query,
      resultCount: results.length,
      results,
    };
  }

  /**
   * Google Maps search (`engine=google_maps`, `type=search`).
   * Returns normalized places for GhoomAI discovery flows.
   */
  async searchMaps(input: unknown): Promise<NormalizedMapsResponse> {
    const parsed = mapsSearchParamsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid maps search parameters.");
    }
    const params = parsed.data;

    const qs = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q: params.query,
      api_key: this.apiKey,
    });
    if (params.location) qs.set("location", params.location);
    if (params.language) qs.set("hl", params.language);
    if (params.country) qs.set("gl", params.country);
    if (params.start > 0) qs.set("start", String(params.start));
    // SerpApi requires `z` or `m` whenever `location` is used.
    // Default to city-level zoom unless the caller specified one.
    const zoom = params.zoom ?? (params.location ? DEFAULT_MAPS_ZOOM : undefined);
    if (zoom !== undefined) qs.set("z", String(zoom));

    const json = await this.requestJson(qs);

    const validated = serpApiMapsResponseSchema.safeParse(json);
    if (!validated.success) {
      throw new UpstreamError(
        "Search provider returned an unexpected response shape.",
      );
    }

    return normalizeMapsPlaces(params.query, params.location, validated.data);
  }
}

/** Convenience wrapper for one-off server-side searches. */
export async function searchSerpApi(
  input: unknown,
): Promise<NormalizedSearchResponse> {
  return new SerpApiClient().search(input);
}
