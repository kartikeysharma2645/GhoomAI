import { z } from "zod";

/** Base URL for all SerpApi requests. Engine paths are appended by the client. */
export const SERPAPI_BASE_URL = "https://serpapi.com";

/** Engines verified to work through this gateway. Extend as new engines are adopted. */
export const SUPPORTED_ENGINES = ["google", "google_maps"] as const;

/**
 * Engine identifier. The open `string` tail keeps the gateway extensible so
 * future engines (google_flights, google_hotels, google_news,
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

/** Validated input for a Google Maps search request. */
export const mapsSearchParamsSchema = z.object({
  query: z.string().min(1).max(300),
  location: z.string().max(200).optional(),
  language: z.string().max(10).optional(),
  country: z.string().max(10).optional(),
  /** Result offset for pagination. No pagination UI yet — service-level only. */
  start: z.number().int().min(0).max(100).default(0),
  /**
   * Map zoom level (3-30). SerpApi requires `z` or `m` whenever `location`
   * is used; the client injects a city-level default in that case.
   */
  zoom: z.number().int().min(3).max(30).optional(),
});

export type ValidatedMapsSearchParams = z.infer<typeof mapsSearchParamsSchema>;

const gpsCoordinatesSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
  })
  .passthrough();

/**
 * Minimal shape of one SerpApi Google Maps (`local_results`) place.
 * Every field is optional — SerpApi results vary by place.
 */
const mapsPlaceSchema = z
  .object({
    position: z.number().optional(),
    title: z.string().optional(),
    place_id: z.string().optional(),
    data_id: z.string().optional(),
    data_cid: z.string().optional(),
    rating: z.number().optional(),
    reviews: z.number().optional(),
    price: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    types: z.array(z.string()).optional(),
    address: z.string().optional(),
    description: z.string().optional(),
    open_state: z.string().optional(),
    hours: z.unknown().optional(),
    gps_coordinates: gpsCoordinatesSchema.optional(),
    thumbnail: z.string().optional(),
    links: z.unknown().optional(),
  })
  .passthrough();

/** Minimal shape of a SerpApi Google Maps search response. */
export const serpApiMapsResponseSchema = z
  .object({
    local_results: z.array(mapsPlaceSchema).optional().default([]),
  })
  .passthrough();

export type SerpApiMapsResponse = z.infer<typeof serpApiMapsResponseSchema>;

/** Normalized Google Maps place returned to GhoomAI callers. Never contains secrets. */
export interface NormalizedMapsPlace {
  position: number;
  title: string;
  placeId?: string;
  dataId?: string;
  dataCid?: string;
  rating?: number;
  reviews?: number;
  price?: string;
  placeType?: string;
  placeTypes?: string[];
  address?: string;
  description?: string;
  openState?: string;
  hours?: Record<string, string>;
  gpsCoordinates?: { latitude: number; longitude: number };
  thumbnail?: string;
  links?: Record<string, string>;
}

/** Normalized Google Maps response returned to GhoomAI callers. */
export interface NormalizedMapsResponse {
  engine: "google_maps";
  query: string;
  location?: string;
  resultCount: number;
  results: NormalizedMapsPlace[];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/**
 * Pure normalizer: validated SerpApi Maps payload -> GhoomAI shape.
 * Accepts the schema input type so absent `local_results` is tolerated.
 * Tolerates missing/oddly-shaped optional fields; never throws on place data.
 */
export function normalizeMapsPlaces(
  query: string,
  location: string | undefined,
  data: z.input<typeof serpApiMapsResponseSchema>,
): NormalizedMapsResponse {
  const localResults = data.local_results ?? [];
  const results: NormalizedMapsPlace[] = localResults.map((item, index) => {
      const place: NormalizedMapsPlace = {
        position: item.position ?? index + 1,
        title: item.title ?? "",
      };
      if (item.place_id) place.placeId = item.place_id;
      if (item.data_id) place.dataId = item.data_id;
      if (item.data_cid) place.dataCid = item.data_cid;
      if (typeof item.rating === "number") place.rating = item.rating;
      if (typeof item.reviews === "number") place.reviews = item.reviews;
      if (item.price) place.price = item.price;
      if (typeof item.type === "string") {
        place.placeType = item.type;
      } else if (Array.isArray(item.type) && item.type.length > 0) {
        place.placeTypes = item.type;
      }
      if (item.types) place.placeTypes = item.types;
      if (item.address) place.address = item.address;
      if (item.description) place.description = item.description;
      if (item.open_state) place.openState = item.open_state;
      if (isStringRecord(item.hours)) place.hours = { ...item.hours };
      if (item.gps_coordinates) {
        place.gpsCoordinates = {
          latitude: item.gps_coordinates.latitude,
          longitude: item.gps_coordinates.longitude,
        };
      }
      if (item.thumbnail) place.thumbnail = item.thumbnail;
      if (isStringRecord(item.links)) place.links = { ...item.links };
      return place;
    },
  );

  return {
    engine: "google_maps",
    query,
    ...(location ? { location } : {}),
    resultCount: results.length,
    results,
  };
}
