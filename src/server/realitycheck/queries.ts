import type {
  NormalizedHotel,
  NormalizedMapsPlace,
} from "../services/serpapi/types";
import type { Evidence } from "../trips/plan";

/**
 * Phase 5 Step 1 verification query builders and candidate matchers.
 *
 * PURE: no network, no environment. Builds bounded, reproducible gateway
 * params from planning evidence, and matches fresh candidates back to the
 * planned item — stable ID first, deterministic name fallback second.
 */

export type VerificationEngine = "google_maps" | "google_hotels" | "google";

export interface PlaceVerificationQuery {
  engine: "google_maps";
  query: string;
  location: string;
}

export interface HotelVerificationQuery {
  engine: "google_hotels";
  query: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges?: number[];
  currency: string;
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dedupe key priority: propertyToken → placeId → normalized name + destination. */
export function dedupeKey(
  evidence: Pick<Evidence, "propertyToken" | "placeId">,
  title: string,
  destination: string,
): string {
  if (evidence.propertyToken) return `hotel:${evidence.propertyToken}`;
  if (evidence.placeId) return `place:${evidence.placeId}`;
  return `name:${normalizeName(`${title} ${destination}`)}`;
}

export function buildPlaceQuery(
  title: string,
  destination: string,
): PlaceVerificationQuery {
  return {
    engine: "google_maps",
    query: `${title} ${destination}`.slice(0, 300),
    location: destination,
  };
}

export interface StayQueryInput {
  hotelName: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges?: number[];
  currency: string;
}

export function buildHotelQuery(input: StayQueryInput): HotelVerificationQuery {
  return {
    engine: "google_hotels",
    query: input.hotelName.slice(0, 300),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
    childrenAges: input.childrenAges,
    currency: input.currency,
  };
}

export type PlaceMatch =
  | { matched: true; confident: boolean; place: NormalizedMapsPlace }
  | { matched: false };

/**
 * Matches fresh Maps candidates to the planned place.
 * Confident: stable placeId equality. Fallback: normalized title equality.
 * Anything weaker is no match — never force one.
 */
export function matchPlace(
  candidates: NormalizedMapsPlace[],
  evidence: Pick<Evidence, "placeId">,
  title: string,
): PlaceMatch {
  if (evidence.placeId) {
    const byId = candidates.find((c) => c.placeId === evidence.placeId);
    if (byId) return { matched: true, confident: true, place: byId };
  }
  const want = normalizeName(title);
  if (!want) return { matched: false };
  const byName = candidates.find(
    (c) => c.title && normalizeName(c.title) === want,
  );
  if (byName) return { matched: true, confident: false, place: byName };
  return { matched: false };
}

export type HotelMatch =
  | { matched: true; confident: boolean; hotel: NormalizedHotel }
  | { matched: false };

/**
 * Matches fresh hotel candidates to the planned stay.
 * Confident: stable propertyToken equality. Fallback: normalized name
 * equality. Anything weaker is no match — never force one.
 */
export function matchHotel(
  candidates: NormalizedHotel[],
  evidence: Pick<Evidence, "propertyToken">,
  hotelName: string,
): HotelMatch {
  if (evidence.propertyToken) {
    const byToken = candidates.find(
      (h) => h.propertyToken === evidence.propertyToken,
    );
    if (byToken) return { matched: true, confident: true, hotel: byToken };
  }
  const want = normalizeName(hotelName);
  if (!want) return { matched: false };
  const byName = candidates.find(
    (h) => h.name && normalizeName(h.name) === want,
  );
  if (byName) return { matched: true, confident: false, hotel: byName };
  return { matched: false };
}
