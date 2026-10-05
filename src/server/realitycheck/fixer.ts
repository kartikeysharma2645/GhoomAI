import { z } from "zod";
import { ValidationError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedHotel,
  NormalizedMapsPlace,
} from "../services/serpapi/types";
import { estimateDuration, pickStay } from "../planning/builder";
import { scorePlace } from "../planning/scoring";
import { tripPlanSchema, type Evidence, type ItineraryItem, type TripPlan } from "../trips/plan";
import {
  tripRequirementsSchema,
  type TripRequirements,
} from "../trips/requirements";
import {
  realityCheckResultSchema,
  type ItemCheck,
  type RealityCheckResult,
} from "./checks";
import {
  replanProposalSchema,
  type ProposedChange,
  type ReplanProposal,
  type UnfixableIssue,
} from "./proposal";
import {
  verifyPlaceTargets,
  verifyStayTarget,
  type PlaceTarget,
  type StayTarget,
  type VerifyDeps,
} from "./service";

/**
 * Phase 5 Step 3 fixer: turns actionable RealityCheck findings into
 * bounded, user-approvable ReplanProposals.
 *
 * Rules enforced here:
 * - Only PROBLEM and actionable NEEDS_ATTENTION findings enter the fixer.
 *   UNVERIFIED never enters; rating/review-only drift is skipped.
 * - Every replacement originates from a fresh live gateway call.
 * - Every replacement is re-verified through the real verification path.
 * - The input plan and check are only read; all outputs are new objects.
 * - Bounded: max 3 issues, 3 candidates and 3 verify attempts per issue.
 */

export const MAX_ACTIONABLE_ISSUES = 3;
export const MAX_CANDIDATES_PER_ISSUE = 3;
export const MAX_VERIFY_ATTEMPTS_PER_ISSUE = 3;

const fixRequestSchema = z.object({
  plan: tripPlanSchema,
  check: realityCheckResultSchema,
  requirements: tripRequirementsSchema.optional(),
});

/** NEEDS_ATTENTION facts that justify searching for a replacement. */
function isActionableAttention(check: Pick<ItemCheck, "facts">): boolean {
  return check.facts.some(
    (f) =>
      (f.fact === "hotelPrice" &&
        (f.outcome === "changed" || f.outcome === "conflicting")) ||
      (f.fact === "openState" &&
        (f.outcome === "changed" || f.outcome === "conflicting")) ||
      (f.fact === "address" && f.outcome === "changed"),
  );
}

export function isActionable(check: Pick<ItemCheck, "status" | "facts">): boolean {
  if (check.status === "PROBLEM") return true;
  if (check.status === "NEEDS_ATTENTION") return isActionableAttention(check);
  return false;
}

/** A recheck passes when it is clean or carries only non-actionable notes. */
function candidatePasses(recheck: ItemCheck): boolean {
  if (recheck.status === "VERIFIED") return true;
  if (recheck.status !== "NEEDS_ATTENTION") return false;
  return !isActionableAttention(recheck);
}

function failureSummary(check: ItemCheck): string {
  const detail = check.facts
    .map((f) => f.detail)
    .find((d): d is string => typeof d === "string" && d.length > 0);
  const base = check.reasons[0] ?? "Verification flagged this item.";
  const text = detail ?? base;
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

interface PlanLocation {
  dayNumber: number;
  item: ItineraryItem;
}

function locatePlanItems(plan: TripPlan): Map<string, PlanLocation> {
  const locations = new Map<string, PlanLocation>();
  for (const day of plan.days) {
    for (const item of day.items) {
      locations.set(item.id, { dayNumber: day.dayNumber, item });
    }
  }
  return locations;
}

/** Stable keys of everything currently scheduled (for exclusion). */
function scheduledKeys(plan: TripPlan): Set<string> {
  const keys = new Set<string>();
  for (const day of plan.days) {
    for (const item of day.items) {
      for (const ev of item.evidence) {
        if (ev.placeId) keys.add(`place:${ev.placeId}`);
      }
      if (item.place?.name) keys.add(`name:${item.place.name.toLowerCase()}`);
      if (item.title) keys.add(`name:${item.title.toLowerCase()}`);
    }
  }
  if (plan.stay) {
    if (plan.stay.evidence?.propertyToken) {
      keys.add(`hotel:${plan.stay.evidence.propertyToken}`);
    }
    keys.add(`name:${plan.stay.hotelName.toLowerCase()}`);
  }
  return keys;
}

function candidateKeyPlace(place: NormalizedMapsPlace): string[] {
  const keys: string[] = [];
  if (place.placeId) keys.push(`place:${place.placeId}`);
  if (place.title) keys.push(`name:${place.title.toLowerCase()}`);
  return keys;
}

function candidateKeyHotel(hotel: NormalizedHotel): string[] {
  const keys: string[] = [];
  if (hotel.propertyToken) keys.push(`hotel:${hotel.propertyToken}`);
  if (hotel.name) keys.push(`name:${hotel.name.toLowerCase()}`);
  return keys;
}

function failedKeys(check: ItemCheck): Set<string> {
  const keys = new Set<string>();
  const ev = check.plannedEvidence;
  if (ev?.placeId) keys.add(`place:${ev.placeId}`);
  if (ev?.propertyToken) keys.add(`hotel:${ev.propertyToken}`);
  return keys;
}

interface RankedPlace {
  place: NormalizedMapsPlace;
  score: number;
  reasons: string[];
}

function rankPlaces(
  pool: NormalizedMapsPlace[],
  interests: string[],
  exclude: Set<string>,
  failed: Set<string>,
  limit: number,
): RankedPlace[] {
  const scored = pool
    .map((place, index) => {
      const scored = scorePlace(place, index, {
        interests,
        scheduledTypesToday: new Set(),
        scheduledKeys: new Set(),
      });
      return { place, score: scored.score, reasons: scored.reasons };
    })
    .filter(
      ({ place }) =>
        place.title &&
        place.title.trim().length > 0 &&
        !candidateKeyPlace(place).some((k) => exclude.has(k) || failed.has(k)),
    );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function mapsEvidence(
  place: NormalizedMapsPlace,
  observedAt: string,
  purpose: "attraction" | "meal",
  query: string,
): Evidence {
  return {
    engine: "google_maps",
    observedAt,
    placeId: place.placeId,
    sourceUrl:
      place.links && typeof place.links.website === "string"
        ? place.links.website
        : undefined,
    query,
    purpose,
    facts: {
      rating: place.rating,
      reviews: place.reviews,
      address: place.address,
      openState: place.openState,
    },
  };
}

function hotelEvidence(
  hotel: NormalizedHotel,
  observedAt: string,
  query: string,
  currency: string,
): Evidence {
  return {
    engine: "google_hotels",
    observedAt,
    propertyToken: hotel.propertyToken,
    query,
    purpose: "stay_selection",
    currency,
    facts: {
      rating: hotel.overallRating,
      reviews: hotel.reviews,
      nightlyExtracted: hotel.nightlyLowestExtracted,
      totalExtracted: hotel.totalLowestExtracted,
    },
  };
}

export async function fixTrip(
  input: unknown,
  client: SerpApiClient = new SerpApiClient(),
  now: Date = new Date(),
): Promise<ReplanProposal> {
  const parsed = fixRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid fix request.");
  }
  const plan = parsed.data.plan;
  const check = parsed.data.check;
  const checkedAt = now.toISOString();
  const deps: VerifyDeps = {
    client,
    destination: plan.destination,
    checkedAt,
    counters: { failures: 0, successes: 0 },
  };

  const requirements: TripRequirements =
    parsed.data.requirements ??
    tripRequirementsSchema.parse({
      destination: plan.destination,
      dateMode: plan.dateMode,
      startDate: plan.startDate,
      endDate: plan.endDate,
      durationDays: plan.durationDays,
      adults: plan.party.adults,
      children: plan.party.children,
      interests: [],
      pace: "balanced",
    });

  const actionable = [
    ...check.items.filter((i) => i.status === "PROBLEM"),
    ...check.items.filter(
      (i) => i.status === "NEEDS_ATTENTION" && isActionable(i),
    ),
  ];
  const warnings: string[] = [];
  if (actionable.length > MAX_ACTIONABLE_ISSUES) {
    warnings.push(
      `Only the first ${MAX_ACTIONABLE_ISSUES} of ${actionable.length} actionable findings were processed.`,
    );
  }
  const actionableCapped = actionable.slice(0, MAX_ACTIONABLE_ISSUES);
  const unfixable: UnfixableIssue[] = [];
  for (const dropped of actionable.slice(MAX_ACTIONABLE_ISSUES)) {
    unfixable.push({
      itemId: dropped.itemId,
      title: dropped.title,
      status: dropped.status,
      reason:
        "Not processed: maximum 3 actionable issues per proposal.",
    });
  }

  const locations = locatePlanItems(plan);
  const scheduled = scheduledKeys(plan);
  const changes: ProposedChange[] = [];

  const currency = plan.totals.currency;

  for (const issue of actionableCapped) {
    const location = locations.get(issue.itemId);
    const isStayIssue =
      issue.itemId === "stay" || issue.kind === "stay";

    if (isStayIssue) {
      const fixed =
        plan.dateMode === "fixed" && plan.startDate && plan.endDate;
      if (!fixed || !plan.stay) {
        unfixable.push({
          itemId: issue.itemId,
          title: issue.title,
          status: issue.status,
          reason:
            "Stay issues require exact trip dates; flexible-date stays cannot be fairly re-priced.",
        });
        continue;
      }
      let hotels: NormalizedHotel[];
      let query: string;
      try {
        const res = await client.searchHotels({
          query: `hotels in ${plan.destination}`,
          checkIn: plan.startDate as string,
          checkOut: plan.endDate as string,
          adults: plan.party.adults,
          children: plan.party.children,
          currency,
        });
        hotels = res.results;
        query = `hotels in ${plan.destination}`;
      } catch {
        unfixable.push({
          itemId: issue.itemId,
          title: issue.title,
          status: issue.status,
          reason: "Stay research request failed; no live alternative available.",
        });
        continue;
      }
      const failed = failedKeys(issue);
      const nights = plan.stay.nights;
      let pool = hotels.filter(
        (h) =>
          h.name &&
          !candidateKeyHotel(h).some(
            (k) => scheduled.has(k) || failed.has(k),
          ),
      );
      const tried: NormalizedHotel[] = [];
      let placed = false;
      for (
        let attempt = 0;
        attempt < MAX_VERIFY_ATTEMPTS_PER_ISSUE && pool.length > 0;
        attempt += 1
      ) {
        const pick = pickStay(pool, nights, plan.budget?.amount, currency);
        if (!pick || tried.length >= MAX_CANDIDATES_PER_ISSUE) break;
        tried.push(pick.hotel);
        pool = pool.filter((h) => h !== pick.hotel);
        const target = {
          type: "stay" as const,
          itemIds: [{ itemId: issue.itemId, kind: "stay", title: pick.hotel.name }],
          hotelName: pick.hotel.name,
          evidence: hotelEvidence(pick.hotel, checkedAt, query, currency),
          checkIn: plan.startDate as string,
          checkOut: plan.endDate as string,
          adults: plan.party.adults,
          children: plan.party.children,
          currency,
          nights,
          plannedTotal: undefined,
          budgetAmount: plan.budget?.amount,
          key: `hotel:${pick.hotel.propertyToken ?? pick.hotel.name}`,
        };
        const [recheck] = await verifyStayTarget(target, deps);
        if (recheck && candidatePasses(recheck)) {
          changes.push({
            itemId: issue.itemId,
            dayNumber: 1,
            action: "replace_stay",
            originalTitle: issue.title,
            originalFinding: {
              status: issue.status,
              summary: failureSummary(issue),
            },
            replacement: {
              id: issue.itemId,
              kind: "stay",
              title: pick.hotel.name,
              place: {
                name: pick.hotel.name,
                address: undefined,
                rating: pick.hotel.overallRating,
              },
              evidence: [recheck.freshEvidence ?? target.evidence].filter(
                (e): e is Evidence => e !== undefined,
              ),
              cost:
                typeof pick.hotel.nightlyLowestExtracted === "number"
                  ? {
                      label: `Stay: ${pick.hotel.name} × ${nights} night${nights === 1 ? "" : "s"}`,
                      amount: pick.hotel.nightlyLowestExtracted * nights,
                      currency,
                      basis: "live" as const,
                    }
                  : undefined,
              notes: `Replacement stay for ${nights} night${nights === 1 ? "" : "s"}. Re-verify before booking.`,
              selectionReasons: [
                `Live nightly ${pick.hotel.nightlyLowest ?? "price unavailable"}`,
                `Re-check status: ${recheck.status}`,
              ],
            },
            candidatesConsidered: tried.length,
            reasons: [
              `Selected ${pick.hotel.name} from ${pool.length + tried.length} live candidate(s).`,
              `Re-check status: ${recheck.status}.`,
            ],
            recheck,
          });
          placed = true;
          break;
        }
      }
      if (!placed) {
        unfixable.push({
          itemId: issue.itemId,
          title: issue.title,
          status: issue.status,
          reason:
            tried.length === 0
              ? "No live stay alternative was found."
              : "Live alternatives did not pass re-verification.",
        });
      }
      continue;
    }

    if (!location) {
      unfixable.push({
        itemId: issue.itemId,
        title: issue.title,
        status: issue.status,
        reason: "Original itinerary item not found in the submitted plan.",
      });
      continue;
    }

    const originQuery =
      location.item.evidence[0]?.query?.trim() ||
      `${location.item.title} ${plan.destination}`;
    let pool: NormalizedMapsPlace[];
    try {
      const res = await client.searchMaps({
        query: originQuery,
        location: plan.destination,
      });
      pool = res.results;
    } catch {
      unfixable.push({
        itemId: issue.itemId,
        title: issue.title,
        status: issue.status,
        reason: "Replacement research request failed; no live alternative available.",
      });
      continue;
    }

    const failed = failedKeys(issue);
    const ranked = rankPlaces(
      pool,
      requirements.interests,
      scheduled,
      failed,
      MAX_CANDIDATES_PER_ISSUE,
    );
    if (ranked.length === 0) {
      unfixable.push({
        itemId: issue.itemId,
        title: issue.title,
        status: issue.status,
        reason: "No live alternative was found.",
      });
      continue;
    }

    let placed = false;
    let attempts = 0;
    for (const candidate of ranked) {
      if (attempts >= MAX_VERIFY_ATTEMPTS_PER_ISSUE) break;
      attempts += 1;
      const purpose = location.item.kind === "meal" ? "meal" as const : "attraction" as const;
      const evidence = mapsEvidence(candidate.place, checkedAt, purpose, originQuery);
      const target = {
        type: "place" as const,
        itemIds: [{ itemId: issue.itemId, kind: location.item.kind, title: candidate.place.title ?? issue.title }],
        title: candidate.place.title ?? issue.title,
        queryTitle: candidate.place.title ?? issue.title,
        evidence,
        key: `fix:${issue.itemId}:${candidate.place.placeId ?? candidate.place.title}`,
      };
      const [recheck] = await verifyPlaceTargets([target], deps);
      if (recheck && candidatePasses(recheck)) {
        const isMeal = location.item.kind === "meal";
        changes.push({
          itemId: issue.itemId,
          dayNumber: location.dayNumber,
          action: isMeal ? "replace_meal" : "replace_attraction",
          originalTitle: issue.title,
          originalFinding: {
            status: issue.status,
            summary: failureSummary(issue),
          },
          replacement: {
            id: issue.itemId,
            kind: location.item.kind,
            title: isMeal
              ? `Lunch near ${candidate.place.title}`
              : (candidate.place.title ?? issue.title),
            startTime: location.item.startTime,
            endTime: location.item.endTime,
            estimatedDurationMinutes: estimateDuration(candidate.place),
            place: {
              name: candidate.place.title ?? issue.title,
              address: candidate.place.address,
              rating: candidate.place.rating,
            },
            evidence: [recheck.freshEvidence ?? evidence],
            selectionReasons: [
              ...candidate.reasons.slice(0, 4),
              `Re-check status: ${recheck.status}`,
            ],
            notes: isMeal
              ? "Replacement pick from live restaurant options; hours vary by venue."
              : undefined,
          },
          candidatesConsidered: attempts,
          reasons: [
            `Selected ${candidate.place.title} from ${ranked.length} live candidate(s).`,
            `Re-check status: ${recheck.status}.`,
          ],
          recheck,
        });
        placed = true;
        break;
      }
    }
    if (!placed) {
      unfixable.push({
        itemId: issue.itemId,
        title: issue.title,
        status: issue.status,
        reason: "Live alternatives did not pass re-verification.",
      });
    }
  }

  const changedIds = new Set(changes.map((c) => c.itemId));
  const unfixableIds = new Set(unfixable.map((u) => u.itemId));
  const unchangedItemIds: string[] = [];
  for (const day of plan.days) {
    for (const item of day.items) {
      if (!changedIds.has(item.id) && !unfixableIds.has(item.id)) {
        unchangedItemIds.push(item.id);
      }
    }
  }
  if (plan.stay && !changedIds.has("stay") && !unfixableIds.has("stay")) {
    unchangedItemIds.push("stay");
  }

  const rechecks = changes.map((c) => c.recheck);
  const recheckSummary = {
    verified: rechecks.filter((r) => r.status === "VERIFIED").length,
    needsAttention: rechecks.filter((r) => r.status === "NEEDS_ATTENTION").length,
    problem: rechecks.filter((r) => r.status === "PROBLEM").length,
    unverified: rechecks.filter((r) => r.status === "UNVERIFIED").length,
  };

  const proposal: ReplanProposal = {
    basedOnCheckedAt: check.checkedAt,
    changes,
    unchangedItemIds,
    unfixable,
    recheckSummary,
    warnings,
  };
  return replanProposalSchema.parse(proposal);
}
