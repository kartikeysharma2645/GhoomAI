import type { NormalizedMapsPlace } from "../services/serpapi/types";
import { INTEREST_MATCHERS } from "../interests";

/**
 * Phase 4 Step 2 deterministic candidate scoring.
 *
 * PURE: no network, no environment, no clients. Uses only normalized
 * candidate fields that actually exist (rating, reviews, type/title text).
 * All weights are named constants. Never returns NaN or Infinity.
 */

export const RATING_WEIGHT = 0.6;
export const REVIEW_WEIGHT = 0.25;
export const INTEREST_BONUS = 0.35;
export const CATEGORY_PENALTY = 0.5;
export const REPEAT_PENALTY = 0.3;

/** Review volume is log-scaled; ~1M reviews saturates the signal. */
const REVIEW_SCALE = 6;

export interface ScoreContext {
  interests: string[];
  /** Lowercased place-type labels already scheduled today. */
  scheduledTypesToday: Set<string>;
  /** Stable place keys already scheduled anywhere in the plan. */
  scheduledKeys: Set<string>;
}

export interface CandidateScore {
  score: number;
  reasons: string[];
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function placeKey(place: NormalizedMapsPlace, index: number): string {
  return place.placeId ?? place.title ?? `index:${index}`;
}

function primaryType(place: NormalizedMapsPlace): string {
  return (place.placeType ?? place.placeTypes?.[0] ?? "").toLowerCase();
}

function placeText(place: NormalizedMapsPlace): string {
  return `${place.title ?? ""} ${place.placeType ?? ""} ${(place.placeTypes ?? []).join(" ")}`;
}

/**
 * Scores one candidate. Missing ratings/reviews safely contribute zero.
 * Reasons describe score drivers for UI/debugging — never factual claims.
 */
export function scorePlace(
  place: NormalizedMapsPlace,
  index: number,
  ctx: ScoreContext,
): CandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const rating = typeof place.rating === "number" ? place.rating : undefined;
  if (rating !== undefined) {
    score += RATING_WEIGHT * Math.max(0, Math.min(rating, 5)) / 5;
    if (rating >= 4.5) reasons.push("high rating");
  }

  const reviews = typeof place.reviews === "number" ? place.reviews : undefined;
  if (reviews !== undefined && reviews > 0) {
    score +=
      REVIEW_WEIGHT *
      Math.min(Math.log10(reviews + 1) / REVIEW_SCALE, 1);
    if (reviews >= 10000) reasons.push("high review volume");
  }

  const text = placeText(place);
  for (const interest of ctx.interests) {
    const matcher = INTEREST_MATCHERS[interest];
    if (matcher && matcher.test(text)) {
      score += INTEREST_BONUS;
      reasons.push(`matches ${interest} interest`);
      break;
    }
  }

  const type = primaryType(place);
  if (type && ctx.scheduledTypesToday.has(type)) {
    score -= CATEGORY_PENALTY;
    reasons.push("same category already scheduled today");
  }

  if (ctx.scheduledKeys.has(placeKey(place, index))) {
    score -= REPEAT_PENALTY;
    reasons.push("already scheduled");
  }

  return { score: finite(score), reasons };
}
