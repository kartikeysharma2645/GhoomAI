import { z } from "zod";
import { ConflictError } from "../../lib/errors";
import { tripPlanSchema, type TripPlan } from "../trips/plan";
import {
  activatableStatusSchema,
  canActivate,
  type ActivatableStatus,
} from "./lifecycle";

/**
 * Phase 6 Step 1 active-trip representation.
 *
 * An ActiveTrip references the approved TripPlan as its itinerary baseline
 * via a deep copy — the source plan object is never aliased, so later
 * progress updates cannot mutate approved data. Pure construction except
 * the activation timestamp; no network, no storage, no GPS.
 */

export const ITEM_PROGRESS_STATUSES = [
  "UPCOMING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
] as const;

export type ItemProgressStatus = (typeof ITEM_PROGRESS_STATUSES)[number];

export const itemProgressSchema = z.object({
  itemId: z.string().min(1).max(100),
  status: z.enum(ITEM_PROGRESS_STATUSES),
});

export type ItemProgress = z.infer<typeof itemProgressSchema>;

export const dayProgressSchema = z.object({
  dayNumber: z.number().int().min(1),
  items: z.array(itemProgressSchema),
});

export type DayProgress = z.infer<typeof dayProgressSchema>;

export const activeTripSchema = z.object({
  tripId: z.string().min(1).max(100),
  /** ACTIVE while traveling; COMPLETED after explicit trip completion. */
  status: z.enum(["ACTIVE", "COMPLETED"]),
  activatedFrom: activatableStatusSchema,
  activatedAt: z.string(),
  /** Deep-copied itinerary baseline. Never aliases the source plan. */
  plan: tripPlanSchema,
  currentDayNumber: z.number().int().min(1),
  progress: z.array(dayProgressSchema),
});

export type ActiveTrip = z.infer<typeof activeTripSchema>;

function newTripId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `trip_${crypto.randomUUID()}`;
  }
  return `trip_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function deepCopyPlan(plan: TripPlan): TripPlan {
  return structuredClone(plan);
}

/**
 * Activates an approved/verified plan as a new ActiveTrip.
 * Every itinerary item starts UPCOMING; current day is day 1.
 * Throws ConflictError when the source state may not activate.
 */
export function activateTrip(
  plan: TripPlan,
  fromStatus: ActivatableStatus,
  now: Date = new Date(),
): ActiveTrip {
  if (!canActivate(fromStatus)) {
    throw new ConflictError(
      `Cannot activate a trip from state ${fromStatus}.`,
    );
  }
  const baseline = deepCopyPlan(plan);
  const progress = baseline.days.map((day) => ({
    dayNumber: day.dayNumber,
    items: day.items.map((item) => ({
      itemId: item.id,
      status: "UPCOMING" as const,
    })),
  }));
  const firstDay = baseline.days[0]?.dayNumber ?? 1;
  const trip: ActiveTrip = {
    tripId: newTripId(),
    status: "ACTIVE",
    activatedFrom: fromStatus,
    activatedAt: now.toISOString(),
    plan: baseline,
    currentDayNumber: firstDay,
    progress,
  };
  return activeTripSchema.parse(trip);
}
