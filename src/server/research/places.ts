import { ATTRACTIONS_MAPS_QUERY, FOOD_MAPS_QUERY, INTEREST_MAPS_QUERIES, renderMapsQuery } from "../interests";
import type { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import type { TripRequirements } from "../trips/requirements";

/**
 * Place research: live attraction (and optional food/interest) candidates
 * through the existing gateway. No HTTP here — the injected SerpApiClient
 * owns transport. Quota-conscious by design:
 * always one attractions query, plus at most one food query and one
 * interest query. Only the calls required by the requirements are made.
 */

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
}

export async function researchPlaces(
  client: SerpApiClient,
  requirements: TripRequirements,
): Promise<PlaceResearch> {
  const destination = requirements.destination;
  const attractionsQuery = renderMapsQuery(ATTRACTIONS_MAPS_QUERY, destination);

  const attractions = await client.searchMaps({
    query: attractionsQuery,
    location: destination,
  });

  let food: NormalizedMapsPlace[] = [];
  let foodQuery: string | undefined;
  if (requirements.interests.includes("food")) {
    foodQuery = renderMapsQuery(FOOD_MAPS_QUERY, destination);
    const foodRes = await client.searchMaps({
      query: foodQuery,
      location: destination,
    });
    food = foodRes.results;
  }

  let interestExtra: NormalizedMapsPlace[] = [];
  let interestExtraLabel: string | undefined;
  let interestQuery: string | undefined;
  const extraInterest = requirements.interests.find(
    (i) => i !== "food" && INTEREST_MAPS_QUERIES[i] !== undefined,
  );
  if (extraInterest) {
    interestExtraLabel = extraInterest;
    interestQuery = renderMapsQuery(
      INTEREST_MAPS_QUERIES[extraInterest],
      destination,
    );
    const extraRes = await client.searchMaps({
      query: interestQuery,
      location: destination,
    });
    interestExtra = extraRes.results;
  }

  return {
    attractions: attractions.results,
    food,
    interestExtra,
    interestExtraLabel,
    queries: {
      attractions: attractionsQuery,
      ...(foodQuery ? { food: foodQuery } : {}),
      ...(interestQuery ? { interest: interestQuery } : {}),
    },
  };
}
