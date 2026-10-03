import { z } from "zod";

/** Base URL for all SerpApi requests. Engine paths are appended by the client. */
export const SERPAPI_BASE_URL = "https://serpapi.com";

/** Engines verified to work through this gateway. Extend as new engines are adopted. */
export const SUPPORTED_ENGINES = ["google"] as const;

/**
 * Engine identifier. The open `string` tail keeps the gateway extensible so
 * future engines (google_maps, google_flights, google_hotels, google_news,
 * google_lens, ...) can be added without changing the client signature.
 */
export type SerpApiEngine = (typeof SUPPORTED_ENGINES)[number] | (string & {});

/** Validated input for a SerpApi search request. */
export const searchParamsSchema = z.object({
  engine: z.string().min(1).max(64).default("google"),
  query: z.string().min(1).max(300),
  location: z.string().max(200).optional(),
  language: z.string().max(10).optional(),
  country: z.string().max(10).optional(),
  num: z.number().int().min(1).max(20).default(10),
});

export type ValidatedSearchParams = z.infer<typeof searchParamsSchema>;

/** Minimal shape of one SerpApi organic (Google Search) result. Unknown fields ignored. */
const organicResultSchema = z
  .object({
    position: z.number().optional(),
    title: z.string().optional(),
    link: z.string().optional(),
    snippet: z.string().optional(),
    displayed_link: z.string().optional(),
  })
  .passthrough();

/** Minimal shape of a SerpApi Google Search response. */
export const serpApiSearchResponseSchema = z
  .object({
    organic_results: z.array(organicResultSchema).optional().default([]),
  })
  .passthrough();

export type SerpApiSearchResponse = z.infer<typeof serpApiSearchResponseSchema>;

/** Normalized result item returned to GhoomAI callers. Never contains secrets. */
export interface NormalizedSearchResultItem {
  position: number;
  title: string;
  link: string;
  snippet: string;
  displayedLink?: string;
}

/** Normalized search response returned to GhoomAI callers. Never contains secrets. */
export interface NormalizedSearchResponse {
  engine: string;
  query: string;
  resultCount: number;
  results: NormalizedSearchResultItem[];
}
