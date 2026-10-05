import { ConflictError } from "../../lib/errors";
import { transition } from "./lifecycle";
import {
  activeTripSchema,
  ITEM_PROGRESS_STATUSES,
  type ActiveTrip,
  type ItemProgressStatus,
} from "./activeTrip";

/**
 * Phase 6 Step 2 live-trip progress operations.
 *
 * Pure state transitions over an ActiveTrip snapshot: every operation
 * validates, then returns a NEW ActiveTrip. Inputs are only read.
 * No network, no storage, no GPS, no clock inference.
 */

/** Legal item moves. Terminal states never reopen. */
const ALLOWED_ITEM_TRANSITIONS: Record<
  ItemProgressStatus,
  readonly ItemProgressStatus[]
> = {
  UPCOMING: ["IN_PROGRESS", "SKIPPED"],
  IN_PROGRESS: ["COMPLETED", "SKIPPED"],
  COMPLETED: [],
  SKIPPED: [],
};

/**
 * Enforces one item progress move.
 * Throws ConflictError for anything outside the allowed moves.
 */
export function transitionItemProgress(
  from: ItemProgressStatus,
  to: ItemProgressStatus,
): ItemProgressStatus {
  const allowed = ALLOWED_ITEM_TRANSITIONS[from] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new ConflictError(
      `Invalid item transition from ${from} to ${to}.`,
    );
  }
  return to;
}

function requireActive(trip: ActiveTrip): void {
  if (trip.status !== "ACTIVE") {
    throw new ConflictError(
      `Trip is ${trip.status}; only ACTIVE trips accept updates.`,
    );
  }
}

function deepCopyTrip(trip: ActiveTrip): ActiveTrip {
  return structuredClone(trip);
}

function findDayProgress(
  trip: ActiveTrip,
  dayNumber: number,
): { dayNumber: number; items: Array<{ itemId: string; status: ItemProgressStatus }> } {
  const day = trip.progress.find((d) => d.dayNumber === dayNumber);
  if (!day) {
    throw new ConflictError(`Day ${dayNumber} is not part of this trip.`);
  }
  return day;
}

/**
 * Moves one itinerary item to a new progress state.
 * Returns a new ActiveTrip; the input is never mutated.
 */
export function updateItemProgress(
  trip: ActiveTrip,
  dayNumber: number,
  itemId: string,
  toStatus: ItemProgressStatus,
): ActiveTrip {
  requireActive(trip);
  const day = findDayProgress(trip, dayNumber);
  const entry = day.items.find((i) => i.itemId === itemId);
  if (!entry) {
    throw new ConflictError(
      `Item ${itemId} is not part of day ${dayNumber}.`,
    );
  }
  transitionItemProgress(entry.status, toStatus);
  const next = deepCopyTrip(trip);
  const nextDay = findDayProgress(next, dayNumber);
  const nextEntry = nextDay.items.find((i) => i.itemId === itemId);
  if (!nextEntry) {
    throw new ConflictError(
      `Item ${itemId} is not part of day ${dayNumber}.`,
    );
  }
  nextEntry.status = toStatus;
  return activeTripSchema.parse(next);
}

/**
 * Moves the trip's current day. Viewing a day stays client-side;
 * this changes which day the trip is on. Returns a new ActiveTrip.
 */
export function setCurrentDay(
  trip: ActiveTrip,
  dayNumber: number,
): ActiveTrip {
  requireActive(trip);
  findDayProgress(trip, dayNumber);
  const next = deepCopyTrip(trip);
  next.currentDayNumber = dayNumber;
  return activeTripSchema.parse(next);
}

export interface TripSummary {
  total: number;
  completed: number;
  skipped: number;
  inProgress: number;
  upcoming: number;
  remaining: number;
}

/**
 * Deterministic aggregate progress. Generic notes/context entries are
 * excluded — only real itinerary items count as activities.
 */
export function tripSummary(trip: ActiveTrip): TripSummary {
  const kinds = new Map<string, string>();
  for (const day of trip.plan.days) {
    for (const item of day.items) {
      kinds.set(item.id, item.kind);
    }
  }
  let completed = 0;
  let skipped = 0;
  let inProgress = 0;
  let upcoming = 0;
  for (const day of trip.progress) {
    for (const entry of day.items) {
      if (kinds.get(entry.itemId) === "note") continue;
      if (entry.status === "COMPLETED") completed += 1;
      else if (entry.status === "SKIPPED") skipped += 1;
      else if (entry.status === "IN_PROGRESS") inProgress += 1;
      else upcoming += 1;
    }
  }
  const total = completed + skipped + inProgress + upcoming;
  return {
    total,
    completed,
    skipped,
    inProgress,
    upcoming,
    remaining: total - completed - skipped,
  };
}

/**
 * Completes the trip (ACTIVE → COMPLETED). Rejects while any real
 * itinerary item is still UPCOMING or IN_PROGRESS. Returns a new trip.
 */
export function completeTrip(trip: ActiveTrip): ActiveTrip {
  requireActive(trip);
  const summary = tripSummary(trip);
  if (summary.inProgress > 0 || summary.upcoming > 0) {
    throw new ConflictError(
      `${summary.remaining} item(s) are still unresolved; complete or skip them first.`,
    );
  }
  transition("ACTIVE", "COMPLETED");
  const next = deepCopyTrip(trip);
  const completed: ActiveTrip = { ...next, status: "COMPLETED" };
  return activeTripSchema.parse(completed);
}
