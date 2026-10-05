import { z } from "zod";
import { evidenceSchema } from "../trips/plan";
import { ConflictError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import { estimateDuration } from "../planning/builder";
import { scorePlace } from "../planning/scoring";
import { candidatePasses } from "../realitycheck/fixer";
import {
  verifyPlaceTargets,
  type PlaceTarget,
  type VerifyDeps,
} from "../realitycheck/service";
import { activeTripSchema, type ActiveTrip } from "./activeTrip";
import { itemCheckSchema } from "../realitycheck/checks";
import {
  liveSituationResultSchema,
  type DetectedSituation,
  type LiveSituationResult,
} from "./situation";

/**
 * Phase 7 Prompt 2 bounded reschedule proposals.
 *
 * Turns actionable live situations into user-reviewable replacement
 * proposals. Detection only + proposal: the ActiveTrip is only read,
 * never modified, and nothing is applied here. Every replacement comes
 * from a fresh live gateway call and is re-verified through the existing
 * RealityCheck path before it may appear in a proposal.
 */

export const MAX_RESCHEDULE_ISSUES = 3;
export const MAX_RESCHEDULE_CANDIDATES = 3;
export const MAX_RESCHEDULE_ATTEMPTS = 3;

export const RESCHEDULE_ACTIONS = ["REPLACE_ITEM"] as const;

export const rescheduleChangeSchema = z.object({
  itemId: z.string().min(1).max(100),
  dayNumber: z.number().int().min(1),
  action: z.enum(RESCHEDULE_ACTIONS),
  originalTitle: z.string().min(1).max(300),
  originalFinding: z.object({
    status: z.string().min(1).max(50),
    summary: z.string().min(1).max(500),
  }),
  replacement: z.object({
    id: z.string().min(1).max(100),
    kind: z.string().min(1).max(50),
    title: z.string().min(1).max(300),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    estimatedDurationMinutes: z.number().int().positive().optional(),
    evidence: z.array(evidenceSchema),
    selectionReasons: z.array(z.string()).optional(),
  }),
  candidatesConsidered: z.number().int().min(1),
  reasons: z.array(z.string().max(500)),
  recheck: itemCheckSchema,
});

export type RescheduleChange = z.infer<typeof rescheduleChangeSchema>;

export const unfixableRescheduleSchema = z.object({
  itemId: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  reason: z.string().min(1).max(500),
});

export type UnfixableReschedule = z.infer<typeof unfixableRescheduleSchema>;

export const rescheduleProposalSchema = z.object({
  basedOnCheckedAt: z.string(),
  situationIds: z.array(z.string()),
  changes: z.array(rescheduleChangeSchema),
  unchangedItemIds: z.array(z.string()),
  unfixable: z.array(unfixableRescheduleSchema),
  recheckSummary: z.object({
    verified: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    problem: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string()),
});

export type RescheduleProposal = z.infer<typeof rescheduleProposalSchema>;

/** Situation types that can trigger replacement search. */
const ACTIONABLE_TYPES = ["CLOSED", "TEMPORARILY_CLOSED", "SCHEDULE_CHANGE"] as const;

/** Semantic discovery queries preserving the original item's intent. */
const CATEGORY_QUERIES: Array<{ test: RegExp; template: string }> = [
  { test: /museum|gallery/i, template: "museums in {destination}" },
  { test: /temple|mosque|church|shrine/i, template: "temples in {destination}" },
  { test: /park|garden|zoo/i, template: "parks in {destination}" },
  { test: /market|bazaar|mall/i, template: "markets in {destination}" },
];

export function isActionableSituation(situation: {
  type: string;
}): boolean {
  return (ACTIONABLE_TYPES as readonly string[]).includes(situation.type);
}

/**
 * Deterministic discovery query preserving semantic intent.
 * Meals always use restaurants; attractions use a category template
 * when the title signals one, else the general attractions query.
 */
export function discoveryQueryFor(
  kind: string,
  title: string,
  destination: string,
): string {
  if (kind === "meal") return `restaurants in ${destination}`.slice(0, 300);
  for (const { test, template } of CATEGORY_QUERIES) {
    if (test.test(title)) {
      return template.replace("{destination}", destination).slice(0, 300);
    }
  }
  return `tourist attractions in ${destination}`.slice(0, 300);
}

function minutesBetween(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const parse = (t: string) => {
    const m = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === undefined || e === undefined || e <= s) return undefined;
  return e - s;
}

interface PlanItemRef {
  dayNumber: number;
  id: string;
  kind: string;
  title: string;
  startTime?: string;
  endTime?: string;
  evidenceQuery?: string;
}

function locatePlanItem(trip: ActiveTrip, itemId: string): PlanItemRef | undefined {
  for (const day of trip.plan.days) {
    for (const item of day.items) {
      if (item.id === itemId) {
        return {
          dayNumber: day.dayNumber,
          id: item.id,
          kind: item.kind,
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
          evidenceQuery: item.evidence[0]?.query?.trim() || undefined,
        };
      }
    }
  }
  return undefined;
}

/** Stable keys of everything scheduled (failed item included). */
function scheduledTripKeys(trip: ActiveTrip): Set<string> {
  const keys = new Set<string>();
  for (const day of trip.plan.days) {
    for (const item of day.items) {
      for (const ev of item.evidence) {
        if (ev.placeId) keys.add(`place:${ev.placeId}`);
        if (ev.propertyToken) keys.add(`hotel:${ev.propertyToken}`);
      }
      if (item.place?.name) keys.add(`name:${item.place.name.toLowerCase()}`);
      if (item.title) keys.add(`name:${item.title.toLowerCase()}`);
    }
  }
  if (trip.plan.stay) {
    keys.add(`name:${trip.plan.stay.hotelName.toLowerCase()}`);
  }
  return keys;
}

function rankReplacements(
  pool: NormalizedMapsPlace[],
  exclude: Set<string>,
  limit: number,
): Array<{ place: NormalizedMapsPlace; score: number; reasons: string[] }> {
  const scored = pool
    .map((place, index) => {
      const scored = scorePlace(place, index, {
        interests: [],
        scheduledTypesToday: new Set(),
        scheduledKeys: new Set(),
      });
      return { place, score: scored.score, reasons: scored.reasons };
    })
    .filter(
      ({ place }) =>
        place.title &&
        place.title.trim().length > 0 &&
        !candidateKeys(place).some((k) => exclude.has(k)),
    );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export interface RankedReplacement {
  place: NormalizedMapsPlace;
  score: number;
  reasons: string[];
}

export async function proposeReschedule(
  input: unknown,
  client: SerpApiClient = new SerpApiClient(),
  now: Date = new Date(),
): Promise<RescheduleProposal> {
  const parsed = z
    .object({
      trip: activeTripSchema,
      liveCheck: liveSituationResultSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new ConflictError("Invalid reschedule request.");
  }
  const trip = parsed.data.trip;
  const liveCheck: LiveSituationResult = parsed.data.liveCheck;
  if (trip.status !== "ACTIVE") {
    throw new ConflictError(
      `Trip is ${trip.status}; rescheduling requires an ACTIVE trip.`,
    );
  }
  if (liveCheck.destination !== trip.plan.destination) {
    throw new ConflictError(
      "Live check does not belong to the submitted trip.",
    );
  }
  const checkedAt = now.toISOString();
  const deps: VerifyDeps = {
    client,
    destination: trip.plan.destination,
    checkedAt,
    counters: { failures: 0, successes: 0 },
  };
  const warnings: string[] = [
    "Route feasibility could not be fully verified with available live data.",
  ];

  const actionable = liveCheck.situations.filter(isActionableSituation);
  const capped = actionable.slice(0, MAX_RESCHEDULE_ISSUES);
  if (actionable.length > MAX_RESCHEDULE_ISSUES) {
    warnings.push(
      `Only the first ${MAX_RESCHEDULE_ISSUES} of ${actionable.length} actionable situations were processed.`,
    );
  }

  // Group issues by discovery query: one live call per distinct query.
  interface IssueWork {
    situation: (typeof capped)[number];
    itemId: string;
    planItem: PlanItemRef;
    originQuery: string;
  }
  const work: IssueWork[] = [];
  const unfixable: UnfixableReschedule[] = [];
  const changes: RescheduleProposal["changes"] = [];
  const usedReplacementKeys = new Set<string>();

  for (const situation of capped) {
    const affected = situation.affectedItemIds.filter((id) =>
      locatePlanItem(trip, id),
    );
    if (affected.length === 0) {
      for (const id of situation.affectedItemIds) {
        unfixable.push({
          itemId: id,
          title: id,
          reason:
            "Affected item no longer exists in the submitted trip.",
        });
      }
      continue;
    }
    // One issue per situation: the first affected item that is replaceable.
    const itemId = affected[0] as string;
    const planItem = locatePlanItem(trip, itemId);
    if (!planItem || planItem.kind === "note" || planItem.kind === "stay") {
      unfixable.push({
        itemId,
        title: planItem?.title ?? itemId,
        reason: "This kind of itinerary item cannot be replaced in this step.",
      });
      continue;
    }
    const originQuery = discoveryQueryFor(
      planItem.kind,
      planItem.title,
      trip.plan.destination,
    );
    work.push({ situation, itemId, planItem, originQuery });
  }

  const pools = new Map<string, NormalizedMapsPlace[] | Error>();
  await Promise.all(
    [...new Set(work.map((w) => w.originQuery))].map(async (query) => {
      try {
        const res = await client.searchMaps({
          query,
          location: trip.plan.destination,
        });
        pools.set(query, res.results);
      } catch (err) {
        pools.set(
          query,
          err instanceof Error ? err : new Error("Replacement research failed."),
        );
      }
    }),
  );

  for (const w of work) {
    const pool = pools.get(w.originQuery);
    if (pool instanceof Error || !pool) {
      unfixable.push({
        itemId: w.itemId,
        title: w.planItem.title,
        reason: "Replacement research request failed; no live alternative available.",
      });
      continue;
    }
    const failedKeys = new Set<string>([
      ...scheduledTripKeys(trip),
      ...usedReplacementKeys,
    ]);
    const ranked = rankReplacements(
      pool,
      failedKeys,
      MAX_RESCHEDULE_CANDIDATES,
    );
    if (ranked.length === 0) {
      unfixable.push({
        itemId: w.itemId,
        title: w.planItem.title,
        reason: "No live alternative was found.",
      });
      continue;
    }
    const windowMinutes = minutesBetween(
      w.planItem.startTime,
      w.planItem.endTime,
    );
    let placed = false;
    let attempts = 0;
    for (const candidate of ranked) {
      if (attempts >= MAX_RESCHEDULE_ATTEMPTS) break;
      if (
        windowMinutes !== undefined &&
        estimateDuration(candidate.place) > windowMinutes
      ) {
        continue;
      }
      attempts += 1;
      const purpose = w.planItem.kind === "meal" ? ("meal" as const) : ("attraction" as const);
      const evidence = {
        engine: "google_maps" as const,
        observedAt: checkedAt,
        placeId: candidate.place.placeId,
        sourceUrl:
          candidate.place.links &&
          typeof candidate.place.links.website === "string"
            ? candidate.place.links.website
            : undefined,
        query: w.originQuery,
        purpose,
        facts: {
          rating: candidate.place.rating,
          reviews: candidate.place.reviews,
          address: candidate.place.address,
          openState: candidate.place.openState,
        },
      };
      const target: PlaceTarget = {
        type: "place",
        itemIds: [
          {
            itemId: w.itemId,
            kind: w.planItem.kind,
            title: candidate.place.title ?? w.planItem.title,
          },
        ],
        title: candidate.place.title ?? w.planItem.title,
        queryTitle: candidate.place.title ?? w.planItem.title,
        evidence,
        key: `reschedule:${w.itemId}:${candidate.place.placeId ?? candidate.place.title}`,
      };
      const [recheck] = await verifyPlaceTargets([target], deps);
      if (recheck && candidatePasses(recheck)) {
        const replacementTitle =
          w.planItem.kind === "meal"
            ? `Lunch near ${candidate.place.title}`
            : (candidate.place.title ?? w.planItem.title);
        for (const k of candidateKeys(candidate.place)) {
          usedReplacementKeys.add(k);
        }
        changes.push({
          itemId: w.itemId,
          dayNumber: w.planItem.dayNumber,
          action: "REPLACE_ITEM",
          originalTitle: w.planItem.title,
          originalFinding: {
            status: w.situation.severity === "high" ? "PROBLEM" : "NEEDS_ATTENTION",
            summary: w.situation.title,
          },
          replacement: {
            id: w.itemId,
            kind: w.planItem.kind,
            title: replacementTitle,
            startTime: w.planItem.startTime,
            endTime: w.planItem.endTime,
            estimatedDurationMinutes: estimateDuration(candidate.place),
            evidence: [recheck.freshEvidence ?? evidence],
            selectionReasons: [
              ...candidate.reasons.slice(0, 4),
              `Re-check status: ${recheck.status}`,
            ],
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
        itemId: w.itemId,
        title: w.planItem.title,
        reason: "Live alternatives did not pass re-verification.",
      });
    }
  }

  const changedIds = new Set(changes.map((c) => c.itemId));
  const unfixableIds = new Set(unfixable.map((u) => u.itemId));
  const unchangedItemIds: string[] = [];
  for (const day of trip.plan.days) {
    for (const item of day.items) {
      if (!changedIds.has(item.id) && !unfixableIds.has(item.id)) {
        unchangedItemIds.push(item.id);
      }
    }
  }

  const rechecks = changes.map((c) => c.recheck);
  const proposal: RescheduleProposal = {
    basedOnCheckedAt: liveCheck.checkedAt,
    situationIds: capped.map((s) => s.situationId),
    changes,
    unchangedItemIds,
    unfixable,
    recheckSummary: {
      verified: rechecks.filter((r) => r.status === "VERIFIED").length,
      needsAttention: rechecks.filter((r) => r.status === "NEEDS_ATTENTION").length,
      problem: rechecks.filter((r) => r.status === "PROBLEM").length,
      unverified: rechecks.filter((r) => r.status === "UNVERIFIED").length,
    },
    warnings,
  };
  return rescheduleProposalSchema.parse(proposal);
}

function candidateKeys(place: NormalizedMapsPlace): string[] {
  const keys: string[] = [];
  if (place.placeId) keys.push(`place:${place.placeId}`);
  if (place.title) keys.push(`name:${place.title.toLowerCase()}`);
  return keys;
}
