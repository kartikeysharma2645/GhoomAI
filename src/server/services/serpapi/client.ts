import {
  ConfigurationError,
  UpstreamError,
  type UpstreamErrorDetails,
  ValidationError,
} from "../../../lib/errors";
import {
  SERPAPI_BASE_URL,
  hotelsSearchParamsSchema,
  mapsSearchParamsSchema,
  normalizeHotels,
  normalizeMapsPlaces,
  searchParamsSchema,
  serpApiHotelsResponseSchema,
  serpApiMapsResponseSchema,
  serpApiSearchResponseSchema,
  type NormalizedHotelsResponse,
  type NormalizedMapsResponse,
  type NormalizedSearchResponse,
} from "./types";

const SEARCH_PATH = "/search.json";
const REQUEST_TIMEOUT_MS = 15_000;
/** Maximum number of request attempts (1 initial + up to 2 retries). */
const MAX_ATTEMPTS = 3;
/** Starting backoff between retries, capped at MAX_BACKOFF_MS. */
const INITIAL_BACKOFF_MS = 500;
/** Upper bound on any single backoff delay, including Retry-After. */
const MAX_BACKOFF_MS = 5000;
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
 * Returns true only for transient failures that may succeed on retry:
 * timeouts, connection failures, HTTP 429, and HTTP 5xx.
 * Non-transient client errors (400, 401, 403, etc.) are never retried.
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof UpstreamError)) return false;
  if (err.message === "Search provider request timed out.") return true;
  if (err.message === "Search provider is unreachable.") return true;
  if (err.status === 429) return true;
  if (err.status !== undefined && err.status >= 500 && err.status < 600) return true;
  return false;
}

/**
 * Parses a Retry-After header into a delay in milliseconds.
 * Accepts a delay-seconds integer or an HTTP-date. Falls back to defaultMs.
 * The result is always capped by the caller to MAX_BACKOFF_MS.
 */
function parseRetryAfter(headers: Headers, defaultMs: number): number {
  const retryAfter = headers.get("Retry-After");
  if (!retryAfter) return defaultMs;
  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return delay > 0 ? delay : 0;
  }
  return defaultMs;
}

/**
 * Backs off for the given number of milliseconds without blocking the
 * event loop. Used between retry attempts.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
   *
   * Retries transient failures (timeouts, connection errors, HTTP 429,
   * and HTTP 5xx) up to MAX_ATTEMPTS total with bounded exponential
   * backoff. Non-transient client errors (400, 401, 403, etc.) are never
   * retried. Retry-After headers are respected when present, capped at
   * MAX_BACKOFF_MS.
   */
  private async requestJson(query: URLSearchParams): Promise<unknown> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(`${SERPAPI_BASE_URL}${SEARCH_PATH}?${query.toString()}`, {
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          lastErr = new UpstreamError("Search provider request timed out.");
        } else {
          lastErr = new UpstreamError("Search provider is unreachable.");
        }
        if (!isRetryableError(lastErr) || attempt === MAX_ATTEMPTS - 1) {
          throw lastErr;
        }
        const backoffMs = Math.min(
          INITIAL_BACKOFF_MS * 2 ** attempt,
          MAX_BACKOFF_MS,
        );
        await sleep(backoffMs);
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        lastErr = mapStatusToError(
          res.status,
          await this.readErrorDetails(res),
        );
        if (!isRetryableError(lastErr) || attempt === MAX_ATTEMPTS - 1) {
          throw lastErr;
        }
        const backoffMs = Math.min(
          parseRetryAfter(res.headers, INITIAL_BACKOFF_MS * 2 ** attempt),
          MAX_BACKOFF_MS,
        );
        await sleep(backoffMs);
        continue;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        lastErr = new UpstreamError(
          "Search provider returned an unreadable response.",
        );
        if (!isRetryableError(lastErr) || attempt === MAX_ATTEMPTS - 1) {
          throw lastErr;
        }
        const backoffMs = Math.min(
          INITIAL_BACKOFF_MS * 2 ** attempt,
          MAX_BACKOFF_MS,
        );
        await sleep(backoffMs);
        continue;
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
        lastErr =
          providerMessage.includes("api key") ||
          providerMessage.includes("invalid") ||
          providerMessage.includes("unauthorized")
            ? new UpstreamError(
                "Search provider rejected the configured API key.",
                undefined,
                {
                  providerError: sanitizeProviderMessage(
                    (json as { error: string }).error,
                    this.apiKey,
                  ),
                },
              )
            : new UpstreamError("Search provider reported an error.", undefined, {
                providerError: sanitizeProviderMessage(
                  (json as { error: string }).error,
                  this.apiKey,
                ),
              });
        throw lastErr;
      }

      return json;
    }
    throw lastErr ?? new UpstreamError("Search provider request failed.");
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

  /**
   * Google Hotels search (`engine=google_hotels`).
   * Returns normalized hotels for GhoomAI stay-planning flows.
   */
  async searchHotels(input: unknown): Promise<NormalizedHotelsResponse> {
    const parsed = hotelsSearchParamsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid hotels search parameters.");
    }
    const params = parsed.data;

    const qs = new URLSearchParams({
      engine: "google_hotels",
      q: params.query,
      check_in_date: params.checkIn,
      check_out_date: params.checkOut,
      adults: String(params.adults),
      children: String(params.children),
      currency: params.currency,
      api_key: this.apiKey,
    });
    if (params.childrenAges && params.childrenAges.length > 0) {
      qs.set("children_ages", params.childrenAges.join(","));
    }
    if (params.language) qs.set("hl", params.language);
    if (params.country) qs.set("gl", params.country);

    const json = await this.requestJson(qs);

    const validated = serpApiHotelsResponseSchema.safeParse(json);
    if (!validated.success) {
      throw new UpstreamError(
        "Search provider returned an unexpected response shape.",
      );
    }

    return normalizeHotels(
      params.query,
      params.checkIn,
      params.checkOut,
      params.currency,
      validated.data,
    );
  }
}

/** Convenience wrapper for one-off server-side searches. */
export async function searchSerpApi(
  input: unknown,
): Promise<NormalizedSearchResponse> {
  return new SerpApiClient().search(input);
}
