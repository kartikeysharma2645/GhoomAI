import type { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import type { TripRequirements } from "../trips/requirements";

/**
 * Place research: live attraction (and optional food) candidates through
 * the existing gateway. No HTTP here — the injected SerpApiClient owns
 * transport. Only the calls required by the requirements are made:
 * always one attractions query, plus at most one food query and one
 * interest query.
 */

export interface PlaceResearch {
  attractions: NormalizedMapsPlace[];
  food: NormalizedMapsPlace[];
  interestExtra: NormalizedMapsPlace[];
  interestExtraLabel?: string;
}

/** Extra discovery queries keyed by interest. Food is handled separately. */
const INTEREST_QUERIES: Record<string, string> = {
  shopping: "markets in",
  nature: "parks in",
  nightlife: "nightlife in",
};

export async function researchPlaces(
  client: SerpApiClient,
  requirements: TripRequirements,
): Promise<PlaceResearch> {
  const destination = requirements.destination;

  const attractions = await client.searchMaps({
    query: `tourist attractions in ${destination}`,
    location: destination,
  });

  let food: NormalizedMapsPlace[] = [];
  if (requirements.interests.includes("food")) {
    const foodRes = await client.searchMaps({
      query: `restaurants in ${destination}`,
      location: destination,
    });
    food = foodRes.results;
  }

  let interestExtra: NormalizedMapsPlace[] = [];
  let interestExtraLabel: string | undefined;
  const extraInterest = requirements.interests.find(
    (i) => i !== "food" && INTEREST_QUERIES[i] !== undefined,
  );
  if (extraInterest) {
    const label = INTEREST_QUERIES[extraInterest];
    interestExtraLabel = extraInterest;
    const extraRes = await client.searchMaps({
      query: `${label} ${destination}`,
      location: destination,
    });
    interestExtra = extraRes.results;
  }

  return {
    attractions: attractions.results,
    food,
    interestExtra,
    interestExtraLabel,
  };
}
