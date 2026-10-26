import {
  ATTRACTIONS_FALLBACK_QUERIES,
  ATTRACTIONS_MAPS_QUERY,
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
 * bounded fallback queries for attractions, one food query, and at most
 * one interest query. Only the calls required by the requirements are made.
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
    // Some results but not enough; keep going to next fallback to accumulate.
    // We don't accumulate across queries because each query is a different
    // search lens; use the best single query's results.
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

export async function researchPlaces(
  client: SerpApiClient,
  requirements: TripRequirements,
): Promise<PlaceResearch> {
  const destination = requirements.destination;
  const allAttempts: ResearchAttempt[] = [];

  // ---- Attractions with bounded fallback ----
  const attractionResearch = await researchAttractions(client, destination);
  allAttempts.push(...attractionResearch.attempts);

  // ---- Food: always researched (restaurants are a core part of any trip) ----
  const foodQuery = renderMapsQuery(FOOD_MAPS_QUERY, destination);
  const foodAttempt: ResearchAttempt = {
    query: foodQuery,
    type: "food",
    resultCount: 0,
  };
  allAttempts.push(foodAttempt);
  let food: NormalizedMapsPlace[] = [];
  let foodStatus: ResearchStatus = "searched";
  try {
    const foodRes = await client.searchMaps({
      query: foodQuery,
      location: destination,
    });
    foodAttempt.resultCount = foodRes.results.length;
    food = foodRes.results;
    if (food.length === 0) foodStatus = "empty";
  } catch (err) {
    foodAttempt.error = err instanceof Error ? err.message : "Research request failed.";
    foodAttempt.resultCount = 0;
    foodStatus = "failed";
  }

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
    attractions: attractionResearch.places,
    food,
    interestExtra,
    interestExtraLabel,
    queries: {
      attractions: attractionResearch.query,
      ...(foodQuery ? { food: foodQuery } : {}),
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
