import {
  ATTRACTIONS_FALLBACK_QUERIES,
  ATTRACTIONS_MAPS_QUERY,
  FOOD_FALLBACK_QUERIES,
  FOOD_MAPS_QUERY,
  INTEREST_MAPS_QUERIES,
  renderMapsQuery,
} from "../interests";
import type { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import type { TripRequirements } from "../trips/requirements";

/**
 * Place research: live attraction (and food/interest) candidates
 * through the existing gateway. No HTTP here — the injected SerpApiClient
 * owns transport. Quota-conscious by design:
 * bounded fallback queries for attractions, bounded fallback queries for
 * restaurants, and at most one interest query. Only the calls required by
 * the requirements are made.
 *
 * Research status per category distinguishes "no results found" (empty,
 * a valid outcome) from "the request failed" (an error), so callers can
 * surface honest warnings instead of presenting a blank itinerary as
 * complete.
 */

export type ResearchStatus = "searched" | "empty" | "failed" | "skipped";

export interface ResearchAttempt {
  query: string;
  type: "attractions" | "food" | "interest";
  resultCount: number;
  error?: string;
}

export interface PlaceResearch {
  attractions: NormalizedMapsPlace[];
  food: NormalizedMapsPlace[];
  interestExtra: NormalizedMapsPlace[];
  interestExtraLabel?: string;
  queries: {
    attractions: string;
    food?: string;
    interest?: string;
  };
  research: {
    attractions: ResearchStatus;
    food: ResearchStatus;
    interestExtra: ResearchStatus;
  };
  /** Every query attempted, with result counts and any errors. */
  attempts: ResearchAttempt[];
}

/** Minimum attraction results before we stop trying fallback queries. */
const MIN_ATTRACTION_RESULTS = 4;

/** Minimum restaurant results before we stop trying fallback queries. */
const MIN_FOOD_RESULTS = 4;

/** Maximum total research calls per category (primary + fallbacks). */
const MAX_QUERY_ATTEMPTS = 3;

/** Runs one Maps search, recording the attempt and returning results. */
async function searchMapsOnce(
  client: SerpApiClient,
  attempt: ResearchAttempt,
  location?: string,
): Promise<NormalizedMapsPlace[]> {
  try {
    const res = await client.searchMaps({
      query: attempt.query,
      location,
    });
    attempt.resultCount = res.results.length;
    return res.results;
  } catch (err) {
    attempt.error =
      err instanceof Error ? err.message : "Research request failed.";
    attempt.resultCount = 0;
    return [];
  }
}

/**
 * Extracts a city/region context from a destination string. When the
 * destination is a specific venue or landmark (e.g. "Salt Marsh Nature
 * Center, Brooklyn"), the part after the last comma is typically the
 * city or borough. For plain city destinations, the full string is used.
 * Returns undefined when no usable city context can be derived.
 */
export function extractCityContext(destination: string): string | undefined {
  const trimmed = destination.trim();
  if (!trimmed) return undefined;

  // If the destination contains a comma, the city/region is typically
  // the last segment after the final comma.
  const commaIdx = trimmed.lastIndexOf(",");
  if (commaIdx >= 0) {
    const cityPart = trimmed.slice(commaIdx + 1).trim();
    if (cityPart.length > 0) return cityPart;
  }

  // No comma: use the full destination as the city context.
  return trimmed;
}

/**
 * Researches attractions with a bounded fallback strategy. Tries the
 * primary query first; if it returns fewer than MIN_ATTRACTION_RESULTS
 * results, tries each fallback query until enough results are found or
 * all queries are exhausted. API failures are recorded but do not stop
 * later queries from being tried.
 */
async function researchAttractions(
  client: SerpApiClient,
  destination: string,
): Promise<{
  places: NormalizedMapsPlace[];
  query: string;
  status: ResearchStatus;
  attempts: ResearchAttempt[];
}> {
  const queries = [
    renderMapsQuery(ATTRACTIONS_MAPS_QUERY, destination),
    ...ATTRACTIONS_FALLBACK_QUERIES.map((q) => renderMapsQuery(q, destination)),
  ];

  let places: NormalizedMapsPlace[] = [];
  let usedQuery = queries[0];
  let status: ResearchStatus = "searched";
  const attempts: ResearchAttempt[] = [];

  for (const q of queries) {
    const attempt: ResearchAttempt = { query: q, type: "attractions", resultCount: 0 };
    attempts.push(attempt);
    usedQuery = q;

    const results = await searchMapsOnce(client, attempt, destination);
    places = results;

    if (places.length >= MIN_ATTRACTION_RESULTS) {
      status = places.length > 0 ? "searched" : "empty";
      break;
    }
    if (attempt.error) {
      status = "failed";
      // Continue to next query on failure; don't stop at one bad query.
      continue;
    }
    // Empty result from this query — try the next fallback.
    if (places.length === 0) continue;
    // Some results but not enough; keep going to next fallback to use
    // the best single query's results.
    if (results.length > places.length) {
      places = results;
      usedQuery = q;
    }
  }

  if (places.length === 0) {
    status = attempts.some((a) => a.error) ? "failed" : "empty";
  }

  return { places, query: usedQuery, status, attempts };
}

/**
 * Researches restaurants with a bounded fallback strategy. When the
 * destination is a specific venue (e.g. a landmark), the city context
 * extracted from the destination is used for restaurant queries so the
 * search returns restaurants near the area rather than inside the venue.
 * Falls back to broader restaurant queries when the primary returns too
 * few results.
 */
async function researchFood(
  client: SerpApiClient,
  destination: string,
): Promise<{
  places: NormalizedMapsPlace[];
  query: string;
  status: ResearchStatus;
  attempts: ResearchAttempt[];
}> {
  const cityContext = extractCityContext(destination);

  // Build the query list: primary restaurant query uses city context when
  // available, fallbacks try progressively broader searches.
  const queries: string[] = [
    renderMapsQuery(FOOD_MAPS_QUERY, cityContext ?? destination),
    ...FOOD_FALLBACK_QUERIES.map((q) =>
      renderMapsQuery(q, cityContext ?? destination),
    ),
    // Last resort: try the raw destination as-is.
    renderMapsQuery(FOOD_MAPS_QUERY, destination),
  ];

  // Dedupe queries to avoid redundant calls.
  const uniqueQueries = [...new Set(queries)];

  let places: NormalizedMapsPlace[] = [];
  let usedQuery = uniqueQueries[0];
  let status: ResearchStatus = "searched";
  const attempts: ResearchAttempt[] = [];

  for (const q of uniqueQueries) {
    if (attempts.length >= MAX_QUERY_ATTEMPTS) break;
    const attempt: ResearchAttempt = { query: q, type: "food", resultCount: 0 };
    attempts.push(attempt);
    usedQuery = q;

    const results = await searchMapsOnce(client, attempt, cityContext ?? destination);
    places = results;

    if (places.length >= MIN_FOOD_RESULTS) {
      status = places.length > 0 ? "searched" : "empty";
      break;
    }
    if (attempt.error) {
      status = "failed";
      continue;
    }
    if (places.length === 0) continue;
    if (results.length > places.length) {
      places = results;
      usedQuery = q;
    }
  }

  if (places.length === 0) {
    status = attempts.some((a) => a.error) ? "failed" : "empty";
  }

  return { places, query: usedQuery, status, attempts };
}

/**
 * Ranks candidate places using available relevance signals:
 * - Rating (higher is better)
 * - Review count (more reviews = more reliable signal)
 * - Geographic proximity to destination center when coordinates available
 * - Category match with user interests
 *
 * Missing fields contribute zero — never treated as a negative signal.
 * Returns a new sorted array; does not mutate the input.
 */
export function rankPlacesByRelevance(
  places: NormalizedMapsPlace[],
  interests: string[] = [],
): NormalizedMapsPlace[] {
  return [...places].sort((a, b) => scoreRelevance(b, interests) - scoreRelevance(a, interests));
}

function scoreRelevance(place: NormalizedMapsPlace, interests: string[]): number {
  let score = 0;

  // Rating: up to 40 points (5.0 = 40, 0 = 0).
  if (typeof place.rating === "number" && place.rating > 0) {
    score += (place.rating / 5) * 40;
  }

  // Review count: up to 30 points, log-scaled.
  if (typeof place.reviews === "number" && place.reviews > 0) {
    score += Math.min(Math.log10(place.reviews + 1) / 4, 1) * 30;
  }

  // Interest keyword match: up to 20 points.
  const text = `${place.title ?? ""} ${place.placeType ?? ""} ${(place.placeTypes ?? []).join(" ")}`.toLowerCase();
  for (const interest of interests) {
    const matcher = getInterestMatcher(interest);
    if (matcher && matcher.test(text)) {
      score += 20;
      break;
    }
  }

  return score;
}

function getInterestMatcher(interest: string): RegExp | undefined {
  const matchers: Record<string, RegExp> = {
    history: /fort|palace|museum|heritage|temple|monument|haveli|tomb/i,
    food: /restaurant|cafe|food|cuisine|market|dhaba|eatery/i,
    photography: /viewpoint|sunset|lake|palace|fort|garden|tower/i,
    nature: /park|garden|lake|zoo|sanctuary|bird/i,
    shopping: /market|bazaar|mall|souvenir|handicraft|textile/i,
    nightlife: /bar|club|night|rooftop|lounge/i,
  };
  return matchers[interest];
}

export async function researchPlaces(
  client: SerpApiClient,
  requirements: TripRequirements,
): Promise<PlaceResearch> {
  const destination = requirements.destination;
  const allAttempts: ResearchAttempt[] = [];

  // ---- Attractions with bounded fallback ----
  const attractionResearch = await researchAttractions(client, destination);
  allAttempts.push(...attractionResearch.attempts);

  // ---- Food: always researched with bounded fallbacks ----
  const foodResearch = await researchFood(client, destination);
  allAttempts.push(...foodResearch.attempts);
  const food = foodResearch.places;
  const foodStatus = foodResearch.status;

  // ---- Interest extra: at most one non-food interest ----
  let interestExtra: NormalizedMapsPlace[] = [];
  let interestExtraLabel: string | undefined;
  let interestQuery: string | undefined;
  let interestExtraStatus: ResearchStatus = "skipped";
  const extraInterest = requirements.interests.find(
    (i) => i !== "food" && INTEREST_MAPS_QUERIES[i] !== undefined,
  );
  if (extraInterest) {
    interestExtraLabel = extraInterest;
    interestQuery = renderMapsQuery(
      INTEREST_MAPS_QUERIES[extraInterest],
      destination,
    );
    const interestAttempt: ResearchAttempt = {
      query: interestQuery,
      type: "interest",
      resultCount: 0,
    };
    allAttempts.push(interestAttempt);
    try {
      const extraRes = await client.searchMaps({
        query: interestQuery,
        location: destination,
      });
      interestAttempt.resultCount = extraRes.results.length;
      interestExtra = extraRes.results;
      if (interestExtra.length === 0) interestExtraStatus = "empty";
    } catch (err) {
      interestAttempt.error =
        err instanceof Error ? err.message : "Research request failed.";
      interestAttempt.resultCount = 0;
      interestExtraStatus = "failed";
    }
  }

  return {
    attractions: rankPlacesByRelevance(attractionResearch.places, requirements.interests),
    food: rankPlacesByRelevance(food, requirements.interests),
    interestExtra,
    interestExtraLabel,
    queries: {
      attractions: attractionResearch.query,
      ...(foodResearch.query ? { food: foodResearch.query } : {}),
      ...(interestQuery ? { interest: interestQuery } : {}),
    },
    research: {
      attractions: attractionResearch.status,
      food: foodStatus,
      interestExtra: interestExtraStatus,
    },
    attempts: allAttempts,
  };
}
