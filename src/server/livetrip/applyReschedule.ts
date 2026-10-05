import { z } from "zod";
import { ConflictError } from "../../lib/errors";
import { activeTripSchema } from "./activeTrip";
import type { ActiveTrip } from "./activeTrip";
import type {
  RescheduleChange,
  RescheduleProposal,
} from "./reschedule";

/**
 * Phase 7 Prompt 3 apply layer: applies user-approved reschedule changes
 * to produce a NEW ActiveTrip.
 *
 * Follows the established apply principles (explicit change IDs, atomic
 * application, stable-ID matching, verified-replacement gate) adapted for
 * live trips:
 * - the embedded itinerary baseline is replaced item-for-item;
 * - progress entries follow stable item IDs, so replaced items restart
 *   as UPCOMING — a new venue is never marked visited;
 * - unrelated progress (including COMPLETED/SKIPPED) is preserved.
 * Inputs are only read. No RealityCheck runs here; verification of the
 * updated trip is a separate client-orchestrated operation.
 */

export const applyRescheduleRequestSchema = z.object({
  changeIds: z.array(z.string().min(1)).min(1),
});

export interface ApplyRescheduleResult {
  trip: ActiveTrip;
  appliedChangeIds: string[];
  warnings: string[];
}

function findPlanItem(
  trip: ActiveTrip,
  itemId: string,
): { dayNumber: number; index: number; kind: string; title: string } | undefined {
  for (const day of trip.plan.days) {
    const index = day.items.findIndex((i) => i.id === itemId);
    if (index >= 0) {
      const item = day.items[index];
      if (item) {
        return { dayNumber: day.dayNumber, index, kind: item.kind, title: item.title };
      }
    }
  }
  return undefined;
}

function findProgressEntry(
  trip: ActiveTrip,
  itemId: string,
): string | undefined {
  for (const day of trip.progress) {
    const entry = day.items.find((i) => i.itemId === itemId);
    if (entry) return entry.status;
  }
  return undefined;
}

/**
 * Compatibility gate for one change. Throws ConflictError on any mismatch
 * so the caller applies nothing.
 */
function assertChangeCompatible(
  trip: ActiveTrip,
  change: RescheduleChange,
): void {
  const found = findPlanItem(trip, change.itemId);
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
  if (found.title !== change.originalTitle) {
    throw new ConflictError(
      `Item ${change.itemId} no longer matches the proposal; proposal is stale.`,
    );
  }
  if (found.kind !== change.replacement.kind) {
    throw new ConflictError(
      `Item ${change.itemId} kind changed since the proposal; proposal is stale.`,
    );
  }
}

function assertChangeVerified(change: RescheduleChange): void {
  if (
    change.recheck.status !== "VERIFIED" &&
    change.recheck.status !== "NEEDS_ATTENTION"
  ) {
    throw new ConflictError(
      `Replacement for ${change.itemId} was not verified; refusing to apply.`,
    );
  }
}

function cloneTrip(trip: ActiveTrip): ActiveTrip {
  return structuredClone(trip);
}

/**
 * Applies explicitly selected reschedule changes to produce a new
 * ActiveTrip. Atomic: any incompatibility aborts with ConflictError and
 * nothing applies. Replaced items restart as UPCOMING with a warning when
 * the original was already in progress.
 */
export function applyReschedule(
  trip: ActiveTrip,
  proposal: RescheduleProposal,
  changeIds: string[],
): ApplyRescheduleResult {
  if (trip.status !== "ACTIVE") {
    throw new ConflictError(
      `Trip is ${trip.status}; only ACTIVE trips accept changes.`,
    );
  }
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

  // Gate everything before changing anything.
  for (const change of selected) {
    assertChangeVerified(change);
    assertChangeCompatible(trip, change);
    const progressStatus = findProgressEntry(trip, change.itemId);
    if (progressStatus === "COMPLETED" || progressStatus === "SKIPPED") {
      throw new ConflictError(
        `Item ${change.itemId} is already ${progressStatus === "COMPLETED" ? "completed" : "skipped"}; proposal is stale.`,
      );
    }
  }

  const next = cloneTrip(trip);
  const warnings: string[] = [];
  const appliedChangeIds: string[] = [];
  for (const change of selected) {
    const day = next.plan.days.find((d) => d.dayNumber === change.dayNumber);
    const index = day?.items.findIndex((i) => i.id === change.itemId) ?? -1;
    if (!day || index < 0) {
      throw new ConflictError(
        `Item ${change.itemId} no longer exists; proposal is stale.`,
      );
    }
    day.items[index] = structuredClone(change.replacement) as (typeof day.items)[number];
    const progressDay = next.progress.find(
      (d) => d.dayNumber === change.dayNumber,
    );
    const entry = progressDay?.items.find((i) => i.itemId === change.itemId);
    if (entry && entry.status === "IN_PROGRESS") {
      warnings.push(
        `${change.originalTitle} was in progress; its replacement starts as upcoming and was not marked visited.`,
      );
    }
    if (progressDay && !entry) {
      progressDay.items.push({ itemId: change.itemId, status: "UPCOMING" });
    } else if (entry) {
      entry.status = "UPCOMING";
    }
    appliedChangeIds.push(change.itemId);
  }

  const parsed = activeTripSchema.safeParse(next);
  if (!parsed.success) {
    throw new ConflictError("Applied trip is invalid; nothing was applied.");
  }
  return { trip: parsed.data, appliedChangeIds, warnings };
}
