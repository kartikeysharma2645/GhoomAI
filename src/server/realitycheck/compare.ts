import type { FactCheck } from "./checks";

/**
 * Phase 5 Step 1 deterministic fact comparators.
 *
 * PURE: no network, no environment, no clients. Every threshold is a named
 * constant with its rationale inline. Missing data is never contradictory:
 * absent fresh facts yield "missing" (neutral), incomparable shapes yield
 * "unverifiable" (neutral). Only "conflicting" drives PROBLEM.
 */

/** Ratings churn with reviews; ±0.3 absorbs normal movement. */
export const RATING_TOLERANCE = 0.3;
/** Review-count drops beyond 20% may signal decline; growth is never bad. */
export const REVIEW_DROP_THRESHOLD = 0.2;
/** Price moves within 5% are noise (taxes, rounding, FX). */
export const PRICE_MATCH_PCT = 0.05;
/** Moves above 15% are significant drift worth flagging. */
export const PRICE_DRIFT_PCT = 0.15;
/**
 * Review drops are only meaningful against a stable base — single-digit
 * counts fluctuate meaninglessly (e.g. 4 → 3 reviews).
 */
export const REVIEW_MIN_BASE = 50;

function pctChange(planned: number, fresh: number): number {
  if (planned === 0) return fresh === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (fresh - planned) / Math.abs(planned);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Normalizes an hours value into a comparable record when possible.
 * Returns undefined when the shape cannot be reliably compared —
 * callers must then mark the fact UNVERIFIABLE, never mismatched.
 */
export function normalizeHours(
  value: unknown,
): { comparable: true; days: Record<string, string> } | { comparable: false } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const days: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== "string") return { comparable: false };
      days[normalizeText(k)] = normalizeText(v);
    }
    return { comparable: true, days };
  }
  return { comparable: false };
}

/** Strong closure signal — the only text-based PROBLEM trigger. */
const CLOSURE_RE = /permanently closed|closed permanently|shut down permanently/i;

export function detectsClosure(openState?: string): boolean {
  return typeof openState === "string" && CLOSURE_RE.test(openState);
}

export function compareRating(
  planned: number | undefined,
  fresh: number | undefined,
): FactCheck {
  if (planned === undefined) {
    return { fact: "rating", supported: true, outcome: "missing" };
  }
  if (fresh === undefined || typeof fresh !== "number") {
    return { fact: "rating", supported: true, planned, outcome: "missing" };
  }
  const diff = Math.abs(fresh - planned);
  if (diff <= RATING_TOLERANCE) {
    return { fact: "rating", supported: true, planned, fresh, outcome: "matched" };
  }
  return {
    fact: "rating",
    supported: true,
    planned,
    fresh,
    outcome: "changed",
    detail: `Rating moved from ${planned} to ${fresh}.`,
  };
}

export function compareReviews(
  planned: number | undefined,
  fresh: number | undefined,
): FactCheck {
  if (planned === undefined || planned <= 0) {
    return { fact: "reviews", supported: true, outcome: "missing" };
  }
  if (fresh === undefined || typeof fresh !== "number") {
    return { fact: "reviews", supported: true, planned, outcome: "missing" };
  }
  if (fresh >= planned) {
    return { fact: "reviews", supported: true, planned, fresh, outcome: "matched" };
  }
  if (planned < REVIEW_MIN_BASE) {
    return {
      fact: "reviews",
      supported: true,
      planned,
      fresh,
      outcome: "matched",
      detail: "Review base too small for a meaningful drop comparison.",
    };
  }
  const drop = (planned - fresh) / planned;
  if (drop <= REVIEW_DROP_THRESHOLD) {
    return { fact: "reviews", supported: true, planned, fresh, outcome: "matched" };
  }
  return {
    fact: "reviews",
    supported: true,
    planned,
    fresh,
    outcome: "changed",
    detail: `Review count dropped from ${planned} to ${fresh}.`,
  };
}

export function compareAddress(
  planned: string | undefined,
  fresh: string | undefined,
): FactCheck {
  if (!planned) {
    return { fact: "address", supported: true, outcome: "missing" };
  }
  if (!fresh || typeof fresh !== "string") {
    return { fact: "address", supported: true, planned, outcome: "missing" };
  }
  const p = normalizeText(planned);
  const f = normalizeText(fresh);
  if (p === f || p.includes(f) || f.includes(p)) {
    return { fact: "address", supported: true, planned, fresh, outcome: "matched" };
  }
  return {
    fact: "address",
    supported: true,
    planned,
    fresh,
    outcome: "changed",
    detail: "Reported address differs from the planned address.",
  };
}

export function compareOpenState(
  planned: string | undefined,
  fresh: string | undefined,
): FactCheck {
  if (!planned) {
    return { fact: "openState", supported: true, outcome: "missing" };
  }
  if (!fresh || typeof fresh !== "string") {
    return { fact: "openState", supported: true, planned, outcome: "missing" };
  }
  if (normalizeText(planned) === normalizeText(fresh)) {
    return { fact: "openState", supported: true, planned, fresh, outcome: "matched" };
  }
  return {
    fact: "openState",
    supported: true,
    planned,
    fresh,
    outcome: "changed",
    detail: `Reported status changed from "${planned}" to "${fresh}".`,
  };
}

export function compareOpenHours(
  planned: unknown,
  fresh: unknown,
): FactCheck {
  if (planned === undefined) {
    return { fact: "openHours", supported: true, outcome: "missing" };
  }
  const p = normalizeHours(planned);
  const f = normalizeHours(fresh);
  if (!p.comparable || !f.comparable) {
    return {
      fact: "openHours",
      supported: true,
      planned,
      fresh,
      outcome: "unverifiable",
      detail: "Opening hours are not in a reliably comparable form.",
    };
  }
  const days = Object.keys(p.days);
  if (days.length === 0) {
    return { fact: "openHours", supported: true, outcome: "missing" };
  }
  const shared = days.filter((d) => d in f.days);
  if (shared.length === 0) {
    return {
      fact: "openHours",
      supported: true,
      planned,
      fresh,
      outcome: "unverifiable",
      detail: "No common days to compare opening hours.",
    };
  }
  const differed = shared.filter((d) => p.days[d] !== f.days[d]);
  if (differed.length === 0) {
    return { fact: "openHours", supported: true, planned, fresh, outcome: "matched" };
  }
  return {
    fact: "openHours",
    supported: true,
    planned,
    fresh,
    outcome: "changed",
    detail: `Opening hours differ on: ${differed.join(", ")}.`,
  };
}

export type PriceDrift = "matched" | "attention" | "significant";

export function compareHotelPrice(
  plannedTotal: number | undefined,
  freshTotal: number | undefined,
): { outcome: FactCheck["outcome"]; drift: PriceDrift; detail?: string; planned?: number; fresh?: number } {
  if (plannedTotal === undefined) {
    return { outcome: "missing", drift: "matched" };
  }
  if (freshTotal === undefined || typeof freshTotal !== "number") {
    return { outcome: "missing", drift: "matched", planned: plannedTotal };
  }
  const change = Math.abs(pctChange(plannedTotal, freshTotal));
  if (change <= PRICE_MATCH_PCT) {
    return { outcome: "matched", drift: "matched", planned: plannedTotal, fresh: freshTotal };
  }
  const detail = `Stay total moved from ${plannedTotal} to ${freshTotal}.`;
  if (change <= PRICE_DRIFT_PCT) {
    return { outcome: "changed", drift: "attention", planned: plannedTotal, fresh: freshTotal, detail };
  }
  return { outcome: "changed", drift: "significant", planned: plannedTotal, fresh: freshTotal, detail };
}
