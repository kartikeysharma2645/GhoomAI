/**
 * Shared interest vocabulary for research queries and candidate matching.
 * Deliberately small: six interests, one Maps query template each.
 * Regexes match against place title/type text only.
 */

export const TRIP_INTERESTS = [
  "history",
  "food",
  "photography",
  "nature",
  "shopping",
  "nightlife",
] as const;

export type TripInterest = (typeof TRIP_INTERESTS)[number];

/** Keyword stems matched against candidate title/type text. */
export const INTEREST_MATCHERS: Record<string, RegExp> = {
  history: /fort|palace|museum|heritage|temple|monument|haveli|tomb/i,
  photography: /viewpoint|sunset|lake|palace|fort|garden|tower/i,
  food: /restaurant|cafe|food|cuisine|market|dhaba|eatery/i,
  nature: /park|garden|lake|zoo|sanctuary|bird/i,
  shopping: /market|bazaar|mall|souvenir|handicraft|textile/i,
  nightlife: /bar|club|night|rooftop|lounge/i,
};

/**
 * Google Maps query templates per interest ("{destination}" substituted by
 * the caller). Food is researched through the dedicated restaurant query,
 * so it has no template here.
 */
export const INTEREST_MAPS_QUERIES: Record<string, string> = {
  history: "historic sites in {destination}",
  photography: "viewpoints in {destination}",
  nature: "parks in {destination}",
  shopping: "markets in {destination}",
  nightlife: "nightlife in {destination}",
};

export const FOOD_MAPS_QUERY = "restaurants in {destination}";
export const ATTRACTIONS_MAPS_QUERY = "tourist attractions in {destination}";

export function renderMapsQuery(
  template: string,
  destination: string,
): string {
  return template.replace("{destination}", destination);
}
