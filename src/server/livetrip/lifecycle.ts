import { z } from "zod";
import { ConflictError } from "../../lib/errors";

/**
 * Phase 6 Step 1 trip lifecycle model.
 *
 * Typed plan states with enforced transitions. Pure: no network, no
 * secrets, no storage. Later steps (tracking, rescheduling) build on
 * these states without redefining them.
 */

export const TRIP_STATUSES = [
  "DRAFT",
  "PLANNED",
  "VERIFIED",
  "APPROVED",
  "ACTIVE",
  "COMPLETED",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const tripStatusSchema = z.enum(TRIP_STATUSES);

/** Valid transitions. Anything else is rejected, never coerced. */
const ALLOWED_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  DRAFT: ["PLANNED"],
  PLANNED: ["VERIFIED"],
  VERIFIED: ["APPROVED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["COMPLETED"],
  COMPLETED: [],
};

/**
 * States from which a trip may be activated. Activation is the sanctioned
 * entry into ACTIVE: APPROVED follows the chain directly, while VERIFIED
 * is accepted as an explicit user-approved activation without a recorded
 * APPROVED step. No other state may activate.
 */
export const ACTIVATABLE_STATUSES = ["VERIFIED", "APPROVED"] as const;

export type ActivatableStatus = (typeof ACTIVATABLE_STATUSES)[number];

export const activatableStatusSchema = z.enum(ACTIVATABLE_STATUSES);

/**
 * Enforces a single lifecycle transition.
 * Throws ConflictError for anything outside the allowed chain.
 */
export function transition(from: TripStatus, to: TripStatus): TripStatus {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new ConflictError(
      `Invalid trip transition from ${from} to ${to}.`,
    );
  }
  return to;
}

/** Whether a plan in the given state may be activated. */
export function canActivate(status: TripStatus): boolean {
  return (ACTIVATABLE_STATUSES as readonly string[]).includes(status);
}
