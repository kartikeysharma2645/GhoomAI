import { ConflictError } from "../../lib/errors";
import {
  tripPlanSchema,
  type Evidence,
  type ItineraryItem,
  type TripPlan,
} from "../trips/plan";
import type {
  ProposedChange,
  ReplanProposal,
} from "./proposal";

/**
 * Phase 5 Step 4 apply layer: applies user-approved proposal changes to
 * produce a NEW TripPlan.
 *
 * Rules:
 * - Pure construction: inputs are only read, outputs are new objects.
 * - Stable item IDs identify targets; array positions never do.
 * - Every selected change is compatibility-checked first; any failure
 *   aborts the whole application (atomic) with ConflictError.
 * - Only re-verified replacements (VERIFIED / non-actionable
 *   NEEDS_ATTENTION rechecks) may be applied.
 * - No RealityCheck runs here — apply and verify stay separate operations.
 */

export interface ApplyResult {
  plan: TripPlan;
  appliedChangeIds: string[];
}

function findItem(
  plan: TripPlan,
  itemId: string,
): { dayNumber: number; index: number; item: ItineraryItem } | undefined {
  for (const day of plan.days) {
    const index = day.items.findIndex((i) => i.id === itemId);
    if (index >= 0) {
      const item = day.items[index];
      if (item) return { dayNumber: day.dayNumber, index, item };
    }
  }
  return undefined;
}

/**
 * Compatibility gate for one change. Throws ConflictError on any mismatch
 * so the caller applies nothing.
 */
function assertCompatible(
  plan: TripPlan,
  change: ProposedChange,
): { dayNumber: number; index: number } | { stay: true } {
  if (change.action === "replace_stay" || change.itemId === "stay") {
    if (!plan.stay) {
      throw new ConflictError(
        "Current plan has no stay section; proposal is stale.",
      );
    }
    if (plan.stay.hotelName !== change.originalTitle) {
      throw new ConflictError(
        "Current stay no longer matches the proposal; proposal is stale.",
      );
    }
    return { stay: true };
  }
  const found = findItem(plan, change.itemId);
  if (!found) {
    throw new ConflictError(
      `Item ${change.itemId} no longer exists; proposal is stale.`,
    );
  }
  if (found.dayNumber !== change.dayNumber) {
    throw new ConflictError(
      `Item ${change.itemId} moved days since the proposal; proposal is stale.`,
    );
  }
  if (found.item.title !== change.originalTitle) {
    throw new ConflictError(
      `Item ${change.itemId} no longer matches the proposal; proposal is stale.`,
    );
  }
  if (found.item.kind !== change.replacement.kind) {
    throw new ConflictError(
      `Item ${change.itemId} kind changed since the proposal; proposal is stale.`,
    );
  }
  return found;
}

function assertRechecked(change: ProposedChange): void {
  if (
    change.recheck.status !== "VERIFIED" &&
    change.recheck.status !== "NEEDS_ATTENTION"
  ) {
    throw new ConflictError(
      `Replacement for ${change.itemId} was not verified; refusing to apply.`,
    );
  }
}

function applyStay(plan: TripPlan, change: ProposedChange): TripPlan {
  const replacement = change.replacement;
  const evidence = replacement.evidence[0];
  const nights = plan.stay?.nights ?? 0;
  return {
    ...plan,
    days: plan.days.map((day) => ({ ...day, items: [...day.items] })),
    stay: {
      hotelName: replacement.title,
      nights,
      nightlyLowest: undefined,
      total: replacement.cost,
      evidence: {
        engine: "google_hotels",
        observedAt: new Date().toISOString(),
        propertyToken: evidence?.propertyToken,
        query: evidence?.query,
        purpose: "stay_selection",
        currency: replacement.cost?.currency ?? plan.totals.currency,
        facts: {
          rating: replacement.place?.rating,
          nightlyExtracted: replacement.cost?.amount,
        },
      } as Evidence,
    },
  };
}

/**
 * Applies explicitly selected proposal changes to produce a new TripPlan.
 * Atomic: any incompatibility aborts with ConflictError and nothing applies.
 */
export function applyReplanProposal(
  plan: TripPlan,
  proposal: ReplanProposal,
  changeIds: string[],
): ApplyResult {
  if (changeIds.length === 0) {
    throw new ConflictError("No changes selected.");
  }
  const byId = new Map(proposal.changes.map((c) => [c.itemId, c]));
  const selected = changeIds.map((id) => {
    const change = byId.get(id);
    if (!change) {
      throw new ConflictError(`Unknown change ${id}; proposal is stale.`);
    }
    return change;
  });

  // Gate everything before mutating anything.
  const gates = selected.map((change) => {
    assertRechecked(change);
    return { change, gate: assertCompatible(plan, change) };
  });

  let next: TripPlan = {
    ...plan,
    days: plan.days.map((day) => ({ ...day, items: [...day.items] })),
  };
  const appliedChangeIds: string[] = [];
  for (const { change, gate } of gates) {
    if ("stay" in gate) {
      next = applyStay(next, change);
    } else {
      const day = next.days.find((d) => d.dayNumber === gate.dayNumber);
      if (!day) {
        throw new ConflictError(
          `Day ${gate.dayNumber} no longer exists; proposal is stale.`,
        );
      }
      day.items[gate.index] = { ...change.replacement };
    }
    appliedChangeIds.push(change.itemId);
  }

  const parsed = tripPlanSchema.safeParse(next);
  if (!parsed.success) {
    throw new ConflictError("Applied plan is invalid; nothing was applied.");
  }
  return { plan: parsed.data, appliedChangeIds };
}
