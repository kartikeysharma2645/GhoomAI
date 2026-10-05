import { ValidationError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedHotel,
  NormalizedMapsPlace,
} from "../services/serpapi/types";
import {
  tripPlanSchema,
  type Evidence,
  type TripPlan,
} from "../trips/plan";
import type {
  FactCheck,
  ItemCheck,
  RealityCheckResult,
  VerificationStatus,
} from "./checks";
import {
  compareAddress,
  compareHotelPrice,
  compareOpenHours,
  compareOpenState,
  compareRating,
  compareReviews,
  detectsClosure,
} from "./compare";
import {
  buildHotelQuery,
  buildPlaceQuery,
  dedupeKey,
  matchHotel,
  matchPlace,
} from "./queries";

/**
 * Phase 5 Step 1 RealityCheck verification service.
 *
 * Re-checks a TripPlan against FRESH live SerpApi data. Orchestration only:
 * selects verifiable items, dedupes, fans out bounded gateway calls with
 * per-item isolation, and resolves deterministic statuses.
 * No fixing, no replanning, no LLM. Original plan evidence is never mutated.
 */

export const MAX_VERIFICATION_ITEMS = 15;

export interface PlaceTarget {
  type: "place";
  itemIds: Array<{ itemId: string; kind: string; title: string }>;
  title: string;
  queryTitle: string;
  evidence?: Evidence;
  key: string;
}

export interface StayTarget {
  type: "stay";
  itemIds: Array<{ itemId: string; kind: string; title: string }>;
  hotelName: string;
  evidence?: Evidence;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  currency: string;
  nights: number;
  plannedTotal?: number;
  budgetAmount?: number;
  key: string;
}

type Target = PlaceTarget | StayTarget;

/** Shared execution context for reusable verification functions. */
export interface VerifyDeps {
  client: SerpApiClient;
  destination: string;
  checkedAt: string;
  counters: { failures: number; successes: number };
}

interface Skipped {
  itemId: string;
  kind: string;
  title: string;
  reason: string;
}

function statusPrecedence(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.includes("PROBLEM")) return "PROBLEM";
  if (statuses.includes("NEEDS_ATTENTION")) return "NEEDS_ATTENTION";
  if (statuses.includes("VERIFIED")) return "VERIFIED";
  return "UNVERIFIED";
}

function factStatus(outcome: FactCheck["outcome"]): VerificationStatus | null {
  if (outcome === "conflicting") return "PROBLEM";
  if (outcome === "changed") return "NEEDS_ATTENTION";
  if (outcome === "matched") return "VERIFIED";
  return null;
}

function toReasons(
  status: VerificationStatus,
  facts: FactCheck[],
  fallback: string,
): string[] {
  const details = facts
    .map((f) => f.detail)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  if (details.length > 0) return details;
  return [fallback];
}

interface PlaceBatch {
  sentQuery: string;
  location: string;
  targets: PlaceTarget[];
}

function sentQueryFor(
  target: PlaceTarget,
  destination: string,
): { query: string; location: string } {
  const fallback = buildPlaceQuery(target.queryTitle, destination);
  // Prefer re-running the discovery query stored in planning evidence:
  // specific place-name queries return empty provider results, while the
  // original discovery query reliably returns matchable candidates.
  const sentQuery = target.evidence?.query?.trim() || fallback.query;
  return { query: sentQuery, location: fallback.location };
}

function resolvePlaceCheck(
  ref: { itemId: string; kind: string; title: string },
  target: PlaceTarget,
  match: ReturnType<typeof matchPlace>,
  candidateCount: number,
  observedAt: string,
  sentQuery: string,
): ItemCheck {
  const planned = target.evidence?.facts;
  if (!match.matched) {
    return {
      itemId: ref.itemId,
      kind: ref.kind,
      title: ref.title,
      status: "UNVERIFIED",
      plannedEvidence: target.evidence,
      facts: [
        {
          fact: "discoverability",
          supported: true,
          outcome: "missing",
          detail: `No matching place found among ${candidateCount} fresh result(s); treated as unverified, not contradictory.`,
        },
      ],
      reasons: [
        "Could not confidently re-identify this place in fresh results.",
      ],
    };
  }
  const facts: FactCheck[] = [
    {
      fact: "discoverability",
      supported: true,
      outcome: "matched",
      detail: match.confident
        ? "Re-identified by stable place identifier."
        : "Re-identified by name match.",
    },
  ];
  if (detectsClosure(match.place.openState)) {
    facts.push({
      fact: "openState",
      supported: true,
      planned: planned?.openState,
      fresh: match.place.openState,
      outcome: "conflicting",
      detail: "Provider reports this place as permanently closed.",
    });
  } else {
    facts.push(compareRating(planned?.rating, match.place.rating));
    facts.push(compareReviews(planned?.reviews, match.place.reviews));
    facts.push(compareAddress(planned?.address, match.place.address));
    facts.push(compareOpenState(planned?.openState, match.place.openState));
    facts.push(compareOpenHours(planned?.hours, match.place.hours));
  }
  const freshEvidence = {
    engine: "google_maps" as const,
    observedAt,
    placeId: match.place.placeId,
    sourceUrl:
      match.place.links && typeof match.place.links.website === "string"
        ? match.place.links.website
        : undefined,
    query: sentQuery,
    purpose: target.evidence?.purpose,
    facts: {
      rating: match.place.rating,
      reviews: match.place.reviews,
      address: match.place.address,
      hours: undefined,
      openState: match.place.openState,
    },
  };
  const status = statusPrecedence(
    facts.map((f) => factStatus(f.outcome) ?? "UNVERIFIED"),
  );
  return {
    itemId: ref.itemId,
    kind: ref.kind,
    title: ref.title,
    status,
    plannedEvidence: target.evidence,
    freshEvidence,
    facts,
    reasons: toReasons(status, facts, "Checked against fresh results."),
  };
}

async function checkPlaceBatch(
  batch: PlaceBatch,
  deps: VerifyDeps,
): Promise<ItemCheck[]> {
  const { sentQuery, location, targets: batchTargets } = batch;
  let candidates: NormalizedMapsPlace[];
  try {
    const res = await deps.client.searchMaps({
      query: sentQuery,
      location,
    });
    candidates = res.results;
  } catch {
    deps.counters.failures += 1;
    return batchTargets.flatMap((target) =>
      target.itemIds.map((ref) => ({
        itemId: ref.itemId,
        kind: ref.kind,
        title: ref.title,
        status: "UNVERIFIED" as const,
        plannedEvidence: target.evidence,
        facts: [],
        reasons: ["Verification request failed; nothing could be confirmed."],
      })),
    );
  }
  deps.counters.successes += 1;
  return batchTargets.flatMap((target) => {
    const match = matchPlace(
      candidates,
      { placeId: target.evidence?.placeId },
      target.queryTitle,
    );
    return target.itemIds.map((ref) =>
      resolvePlaceCheck(
        ref,
        target,
        match,
        candidates.length,
        deps.checkedAt,
        sentQuery,
      ),
    );
  });
}

/**
 * Verifies place targets through the real gateway path, batching targets
 * that share one discovery query. Reused by checkTrip and the fixer.
 */
export async function verifyPlaceTargets(
  targets: PlaceTarget[],
  deps: VerifyDeps,
): Promise<ItemCheck[]> {
  const batches = new Map<string, PlaceBatch>();
  for (const target of targets) {
    const { query, location } = sentQueryFor(target, deps.destination);
    const batchKey = `${query}|||${location}`;
    const existing = batches.get(batchKey);
    if (existing) {
      existing.targets.push(target);
    } else {
      batches.set(batchKey, { sentQuery: query, location, targets: [target] });
    }
  }
  const settled = await Promise.all(
    [...batches.values()].map((batch) => checkPlaceBatch(batch, deps)),
  );
  return settled.flat();
}

async function checkStayTarget(
  target: StayTarget,
  deps: VerifyDeps,
): Promise<ItemCheck[]> {
  const query = buildHotelQuery({
    hotelName: target.hotelName,
    destination: deps.destination,
    checkIn: target.checkIn,
    checkOut: target.checkOut,
    adults: target.adults,
    children: target.children,
    currency: target.currency,
  });
  let candidates: NormalizedHotel[];
  try {
    const res = await deps.client.searchHotels({
      query: query.query,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      adults: query.adults,
      children: query.children,
      currency: query.currency,
    });
    candidates = res.results;
  } catch {
    deps.counters.failures += 1;
    return target.itemIds.map((ref) => ({
      itemId: ref.itemId,
      kind: ref.kind,
      title: ref.title,
      status: "UNVERIFIED" as const,
      plannedEvidence: target.evidence,
      facts: [],
      reasons: ["Verification request failed; nothing could be confirmed."],
    }));
  }
  deps.counters.successes += 1;
  const match = matchHotel(
    candidates,
    { propertyToken: target.evidence?.propertyToken },
    target.hotelName,
  );
  const planned = target.evidence?.facts;
  if (!match.matched) {
    return target.itemIds.map((ref) => ({
      itemId: ref.itemId,
      kind: ref.kind,
      title: ref.title,
      status: "UNVERIFIED" as const,
      plannedEvidence: target.evidence,
      facts: [
        {
          fact: "discoverability",
          supported: true,
          outcome: "missing",
          detail: `No matching property found among ${candidates.length} fresh result(s); treated as unverified, not contradictory.`,
        },
      ],
      reasons: [
        "Could not confidently re-identify this stay in fresh results.",
      ],
    }));
  }
  const freshTotal =
    match.hotel.totalLowestExtracted ??
    (typeof match.hotel.nightlyLowestExtracted === "number"
      ? match.hotel.nightlyLowestExtracted * target.nights
      : undefined);
  const price = compareHotelPrice(target.plannedTotal, freshTotal);
  const facts: FactCheck[] = [
    {
      fact: "discoverability",
      supported: true,
      outcome: "matched",
      detail: match.confident
        ? "Re-identified by stable property token."
        : "Re-identified by name match.",
    },
    compareRating(planned?.rating, match.hotel.overallRating),
    compareReviews(planned?.reviews, match.hotel.reviews),
    {
      fact: "hotelPrice",
      supported: true,
      planned: target.plannedTotal,
      fresh: freshTotal,
      outcome: price.outcome,
      detail: price.detail,
    },
  ];
  let status = statusPrecedence(
    facts.map((f) => factStatus(f.outcome) ?? "UNVERIFIED"),
  );
  // Significant drift becomes PROBLEM only on an actual budget violation.
  if (
    price.drift === "significant" &&
    target.budgetAmount !== undefined &&
    freshTotal !== undefined &&
    freshTotal > target.budgetAmount
  ) {
    status = "PROBLEM";
    facts.push({
      fact: "hotelPrice",
      supported: true,
      planned: target.plannedTotal,
      fresh: freshTotal,
      outcome: "conflicting",
      detail: `Fresh total ${freshTotal} exceeds the trip budget of ${target.budgetAmount}.`,
    });
  }
  const freshEvidence = {
    engine: "google_hotels" as const,
    observedAt: deps.checkedAt,
    propertyToken: match.hotel.propertyToken,
    query: query.query,
    purpose: target.evidence?.purpose,
    currency: target.currency,
    facts: {
      rating: match.hotel.overallRating,
      reviews: match.hotel.reviews,
      nightlyExtracted: match.hotel.nightlyLowestExtracted,
      totalExtracted: match.hotel.totalLowestExtracted,
    },
  };
  return target.itemIds.map((ref) => ({
    itemId: ref.itemId,
    kind: ref.kind,
    title: ref.title,
    status,
    plannedEvidence: target.evidence,
    freshEvidence,
    facts,
    reasons: toReasons(status, facts, "Checked against fresh results."),
  }));
}

/**
 * Verifies one stay target through the real gateway path.
 * Reused by checkTrip and the fixer.
 */
export async function verifyStayTarget(
  target: StayTarget,
  deps: VerifyDeps,
): Promise<ItemCheck[]> {
  return checkStayTarget(target, deps);
}

export async function checkTrip(
  input: unknown,
  client: SerpApiClient = new SerpApiClient(),
  now: Date = new Date(),
  opts?: { maxItems?: number },
): Promise<RealityCheckResult> {
  const parsed = tripPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid trip plan.");
  }
  const plan: TripPlan = parsed.data;
  const checkedAt = now.toISOString();
  const maxItems = opts?.maxItems ?? MAX_VERIFICATION_ITEMS;

  const targets: Target[] = [];
  const skipped: Skipped[] = [];

  function addPlaceTarget(
    itemId: string,
    kind: string,
    title: string,
    queryTitle: string,
    evidence?: Evidence,
  ) {
    const key = dedupeKey(evidence ?? {}, queryTitle, plan.destination);
    const existing = targets.find(
      (t): t is PlaceTarget => t.type === "place" && t.key === key,
    );
    if (existing) {
      existing.itemIds.push({ itemId, kind, title });
      return;
    }
    targets.push({
      type: "place",
      itemIds: [{ itemId, kind, title }],
      title,
      queryTitle,
      evidence,
      key,
    });
  }

  for (const day of plan.days) {
    for (const item of day.items) {
      if (item.kind === "attraction") {
        addPlaceTarget(
          item.id,
          item.kind,
          item.title,
          item.title,
          item.evidence[0],
        );
      } else if (item.kind === "meal") {
        if (item.place?.name) {
          addPlaceTarget(
            item.id,
            item.kind,
            item.title,
            item.place.name,
            item.evidence[0],
          );
        } else {
          skipped.push({
            itemId: item.id,
            kind: item.kind,
            title: item.title,
            reason: "Meal has no identifiable place; not independently verifiable.",
          });
        }
      } else {
        skipped.push({
          itemId: item.id,
          kind: item.kind,
          title: item.title,
          reason: "Informational item; not independently verifiable.",
        });
      }
    }
  }

  if (plan.stay) {
    if (plan.startDate && plan.endDate && plan.dateMode === "fixed") {
      const key = dedupeKey(
        plan.stay.evidence ?? {},
        plan.stay.hotelName,
        plan.destination,
      );
      targets.push({
        type: "stay",
        itemIds: [{ itemId: "stay", kind: "stay", title: plan.stay.hotelName }],
        hotelName: plan.stay.hotelName,
        evidence: plan.stay.evidence,
        checkIn: plan.startDate,
        checkOut: plan.endDate,
        adults: plan.party.adults,
        children: plan.party.children,
        currency: plan.totals.currency,
        nights: plan.stay.nights,
        plannedTotal: plan.stay.total?.amount,
        budgetAmount: plan.budget?.amount,
        key,
      });
    } else {
      skipped.push({
        itemId: "stay",
        kind: "stay",
        title: plan.stay.hotelName,
        reason:
          "Exact travel dates are required for hotel re-verification; flexible-date prices cannot be fairly re-checked.",
      });
    }
  }

  // Budget: verify the most check-worthy targets first (stay, then order).
  const ordered = [
    ...targets.filter((t) => t.type === "stay"),
    ...targets.filter((t) => t.type === "place"),
  ];
  const withinBudget = ordered.slice(0, maxItems);
  const overBudget = ordered.slice(maxItems);
  const warnings: string[] = [];
  if (overBudget.length > 0) {
    warnings.push(
      `${overBudget.length} item(s) exceed the verification budget and were not checked.`,
    );
  }
  const skippedKeys = new Set(withinBudget.map((t) => t.key));

  const itemChecks: ItemCheck[] = [];
  const counters = { failures: 0, successes: 0 };
  const deps: VerifyDeps = {
    client,
    destination: plan.destination,
    checkedAt,
    counters,
  };

  // Batch place targets sharing one discovery query: a single fresh
  // result set verifies every place it contains (matched by stable ID).
  const placeTargets = withinBudget.filter(
    (t): t is PlaceTarget => t.type === "place",
  );
  const stayTargets = withinBudget.filter(
    (t): t is StayTarget => t.type === "stay",
  );

  const settled = await Promise.all([
    verifyPlaceTargets(placeTargets, deps),
    ...stayTargets.map((target) => verifyStayTarget(target, deps)),
  ]);
  for (const checks of settled) itemChecks.push(...checks);

  for (const target of overBudget) {
    for (const ref of target.itemIds) {
      itemChecks.push({
        itemId: ref.itemId,
        kind: ref.kind,
        title: ref.title,
        status: "UNVERIFIED",
        plannedEvidence: target.evidence,
        facts: [],
        reasons: ["Beyond the verification budget; not checked."],
      });
    }
  }

  for (const s of skipped) {
    itemChecks.push({
      itemId: s.itemId,
      kind: s.kind,
      title: s.title,
      status: "UNVERIFIED",
      facts: [],
      reasons: [s.reason],
    });
  }

  if (counters.failures > 0 && counters.successes === 0) {
    warnings.push(
      "All verification requests failed; every checked item is UNVERIFIED.",
    );
  }

  const summary = {
    verified: itemChecks.filter((c) => c.status === "VERIFIED").length,
    needsAttention: itemChecks.filter((c) => c.status === "NEEDS_ATTENTION").length,
    problem: itemChecks.filter((c) => c.status === "PROBLEM").length,
    unverified: itemChecks.filter((c) => c.status === "UNVERIFIED").length,
  };

  return { checkedAt, summary, items: itemChecks, warnings };
}
