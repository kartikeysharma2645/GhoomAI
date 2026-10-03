import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../lib/errors";
import {
  SERPAPI_BASE_URL,
  searchParamsSchema,
  serpApiSearchResponseSchema,
  type NormalizedSearchResponse,
} from "./types";

const SEARCH_PATH = "/search.json";
const REQUEST_TIMEOUT_MS = 15_000;

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

function mapStatusToError(status: number): UpstreamError {
  if (status === 401 || status === 403) {
    return new UpstreamError(
      "Search provider rejected the configured API key.",
      status,
    );
  }
  if (status === 429) {
    return new UpstreamError(
      "Search provider rate limit reached. Try again later.",
      status,
    );
  }
  if (status >= 500) {
    return new UpstreamError(
      "Search provider is temporarily unavailable.",
      status,
    );
  }
  return new UpstreamError("Search provider request failed.", status);
}

/**
 * Server-side gateway for SerpApi Search Engine APIs.
 *
 * Usage:
 *   const client = new SerpApiClient(); // throws ConfigurationError if key missing
 *   const results = await client.search({ engine: "google", query: "..." });
 *
 * Design notes:
 * - All SerpApi traffic flows through this class; no raw fetch calls elsewhere.
 * - Error messages never include the request URL (it carries the API key).
 * - Responses are validated with Zod and normalized before leaving this boundary.
 */
export class SerpApiClient {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getSerpApiKey();
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${SERPAPI_BASE_URL}${SEARCH_PATH}?${qs.toString()}`, {
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
      throw mapStatusToError(res.status);
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
        );
      }
      throw new UpstreamError("Search provider reported an error.");
    }

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
}

/** Convenience wrapper for one-off server-side searches. */
export async function searchSerpApi(
  input: unknown,
): Promise<NormalizedSearchResponse> {
  return new SerpApiClient().search(input);
}
