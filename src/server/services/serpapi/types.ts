import { z } from "zod";

/** Base URL for all SerpApi requests. Engine paths are appended by the client. */
export const SERPAPI_BASE_URL = "https://serpapi.com";

/** Engines verified to work through this gateway. Extend as new engines are adopted. */
export const SUPPORTED_ENGINES = ["google", "google_maps", "google_hotels"] as const;

/**
 * Engine identifier. The open `string` tail keeps the gateway extensible so
 * future engines (google_flights, google_news,
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

/** Strict YYYY-MM-DD shape (format only; calendar validity checked separately). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD string into components, or null when it is not a real
 * calendar date (e.g. 2026-02-31). Round-trips through UTC to catch overflow.
 */
function parseIsoCalendarDate(value: string): {
  y: number;
  m: number;
  d: number;
} | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

const calendarDateSchema = z
  .string()
  .refine((v) => parseIsoCalendarDate(v) !== null, {
    message: "Date must be a valid YYYY-MM-DD calendar date.",
  });

/** Validated input for a Google Hotels search request. */
export const hotelsSearchParamsSchema = z
  .object({
    query: z.string().min(1).max(300),
    checkIn: calendarDateSchema,
    checkOut: calendarDateSchema,
    adults: z.number().int().min(1).max(16).default(2),
    children: z.number().int().min(0).max(10).default(0),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
    currency: z.string().length(3).default("INR"),
    language: z.string().max(10).optional(),
    country: z.string().max(10).optional(),
  })
  .superRefine((val, ctx) => {
    const ci = parseIsoCalendarDate(val.checkIn);
    const co = parseIsoCalendarDate(val.checkOut);
    if (ci && co) {
      const inMs = Date.UTC(ci.y, ci.m - 1, ci.d);
      const outMs = Date.UTC(co.y, co.m - 1, co.d);
      if (outMs <= inMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkOut"],
          message: "checkOut must be strictly after checkIn.",
        });
      }
    }
    const ages = val.childrenAges ?? [];
    if (ages.length !== val.children) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["childrenAges"],
        message: "childrenAges length must match the children count.",
      });
    }
  });

export type ValidatedHotelsSearchParams = z.infer<typeof hotelsSearchParamsSchema>;

const hotelRateSchema = z
  .object({
    lowest: z.string().optional(),
    extracted_lowest: z.number().optional(),
  })
  .passthrough();

const hotelImageSchema = z
  .object({
    thumbnail: z.string().optional(),
  })
  .passthrough();

/**
 * Minimal shape of one SerpApi Google Hotels (`properties`) entry.
 * Only `name` is expected; everything else is optional because hotel and
 * vacation-rental shapes differ.
 */
const hotelPropertySchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    property_token: z.string().optional(),
    overall_rating: z.number().optional(),
    reviews: z.number().optional(),
    location_rating: z.number().optional(),
    rate_per_night: hotelRateSchema.optional(),
    total_rate: hotelRateSchema.optional(),
    amenities: z.array(z.string()).optional(),
    thumbnail: z.string().optional(),
    images: z.array(hotelImageSchema).optional(),
    gps_coordinates: gpsCoordinatesSchema.optional(),
    check_in_time: z.string().optional(),
    check_out_time: z.string().optional(),
    free_cancellation: z.boolean().optional(),
  })
  .passthrough();

/** Minimal shape of a SerpApi Google Hotels response. */
export const serpApiHotelsResponseSchema = z
  .object({
    properties: z.array(hotelPropertySchema).optional().default([]),
  })
  .passthrough();

export type SerpApiHotelsResponse = z.infer<typeof serpApiHotelsResponseSchema>;

/** Maximum amenities kept per hotel — bounds payload size. */
const MAX_AMENITIES = 20;

/** Normalized hotel returned to GhoomAI callers. Never contains secrets. */
export interface NormalizedHotel {
  position: number;
  name: string;
  propertyToken?: string;
  propertyType?: string;
  overallRating?: number;
  reviews?: number;
  locationRating?: number;
  nightlyLowest?: string;
  nightlyLowestExtracted?: number;
  totalLowest?: string;
  totalLowestExtracted?: number;
  amenities?: string[];
  thumbnail?: string;
  gpsCoordinates?: { latitude: number; longitude: number };
  checkInTime?: string;
  checkOutTime?: string;
  /**
   * Set ONLY from an explicit boolean `free_cancellation` field upstream.
   * Never inferred from text.
   */
  freeCancellation?: boolean;
}

/** Normalized Google Hotels response returned to GhoomAI callers. */
export interface NormalizedHotelsResponse {
  engine: "google_hotels";
  query: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  resultCount: number;
  results: NormalizedHotel[];
}

/**
 * Pure normalizer: validated SerpApi Hotels payload -> GhoomAI shape.
 * Defensive against missing/malformed optional nests; never throws on
 * property data and never invents values.
 */
export function normalizeHotels(
  query: string,
  checkIn: string,
  checkOut: string,
  currency: string,
  data: z.input<typeof serpApiHotelsResponseSchema>,
): NormalizedHotelsResponse {
  const properties = data.properties ?? [];
  const results: NormalizedHotel[] = properties.map((item, index) => {
    const hotel: NormalizedHotel = {
      position: index + 1,
      name: item.name ?? "",
    };
    if (item.property_token) hotel.propertyToken = item.property_token;
    if (item.type) hotel.propertyType = item.type;
    if (typeof item.overall_rating === "number") {
      hotel.overallRating = item.overall_rating;
    }
    if (typeof item.reviews === "number") hotel.reviews = item.reviews;
    if (typeof item.location_rating === "number") {
      hotel.locationRating = item.location_rating;
    }
    const nightly = item.rate_per_night;
    if (nightly && typeof nightly === "object") {
      if (nightly.lowest) hotel.nightlyLowest = nightly.lowest;
      if (typeof nightly.extracted_lowest === "number") {
        hotel.nightlyLowestExtracted = nightly.extracted_lowest;
      }
    }
    const total = item.total_rate;
    if (total && typeof total === "object") {
      if (total.lowest) hotel.totalLowest = total.lowest;
      if (typeof total.extracted_lowest === "number") {
        hotel.totalLowestExtracted = total.extracted_lowest;
      }
    }
    if (Array.isArray(item.amenities)) {
      const kept = item.amenities
        .filter((a): a is string => typeof a === "string")
        .slice(0, MAX_AMENITIES);
      if (kept.length > 0) hotel.amenities = kept;
    }
    const firstImageThumbnail =
      Array.isArray(item.images)
        ? item.images.find(
            (img) =>
              img && typeof img === "object" && typeof img.thumbnail === "string",
          )?.thumbnail
        : undefined;
    if (item.thumbnail) {
      hotel.thumbnail = item.thumbnail;
    } else if (firstImageThumbnail) {
      hotel.thumbnail = firstImageThumbnail;
    }
    const gps = item.gps_coordinates;
    if (
      gps &&
      typeof gps === "object" &&
      typeof gps.latitude === "number" &&
      typeof gps.longitude === "number"
    ) {
      hotel.gpsCoordinates = {
        latitude: gps.latitude,
        longitude: gps.longitude,
      };
    }
    if (item.check_in_time) hotel.checkInTime = item.check_in_time;
    if (item.check_out_time) hotel.checkOutTime = item.check_out_time;
    if (typeof item.free_cancellation === "boolean") {
      hotel.freeCancellation = item.free_cancellation;
    }
    return hotel;
  });

  return {
    engine: "google_hotels",
    query,
    checkIn,
    checkOut,
    currency,
    resultCount: results.length,
    results,
  };
}
