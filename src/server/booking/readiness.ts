import { TRIP_STATUSES } from "../livetrip/lifecycle";
import type { RealityCheckResult } from "../realitycheck/checks";
import type { TripPlan } from "../trips/plan";
import type { BookingReadiness, HandoffItem } from "./types";

/**
 * Phase 9 Prompt 1 booking readiness evaluation.
 *
 * Deterministic and pure: no network, no secrets, no storage, no SerpApi.
 * Reuses the existing lifecycle (DRAFT → PLANNED → VERIFIED → APPROVED →
 * ACTIVE → COMPLETED) — no parallel lifecycle is introduced. The caller
 * supplies the current lifecycle status alongside the plan because GhoomAI
 * is stateless (the client holds the plan; see /api/trips/activate).
 *
 * Blocking rules (only what the architecture can reliably know):
 * - unknown status → INVALID_STATE
 * - ACTIVE → ALREADY_ACTIVE (booking window has passed)
 * - COMPLETED → NOT_READY (nothing left to book)
 * - DRAFT / PLANNED / VERIFIED → NOT_READY (explicit approval required)
 * - APPROVED → READY unless:
 *   - the itinerary has no actionable (handoff-eligible) items
 *   - required destination/date information is missing
 *   - the supplied RealityCheck result exposes unresolved PROBLEM items
 *
 * Non-blocking by design: NEEDS_ATTENTION / UNVERIFIED findings, flexible
 * dates (discovery can still run on destination queries), and anything the
 * current architecture cannot reliably know.
 */

export const BOOKING_DISCLAIMER =
  "GhoomAI does not complete bookings. Use the search hints with an external provider to book directly; no booking was made.";

export interface BookingReadinessInput {
  plan: TripPlan;
  /** Current lifecycle status; unknown values yield INVALID_STATE. */
  status: string;
  /** Latest RealityCheck result, when the client has one. Optional. */
  check?: RealityCheckResult;
}

export interface BookingReadinessEvaluation {
  readiness: BookingReadiness;
  tripStatus: string;
  reasons: string[];
  items: HandoffItem[];
}

/** Derives handoff items from the itinerary. Never invents providers/URLs. */
export function collectHandoffItems(plan: TripPlan): HandoffItem[] {
  const items: HandoffItem[] = [];
  const hint = (title: string): string =>
    `${title}, ${plan.destination}`.slice(0, 300);

  if (plan.stay) {
    items.push({
      itemId: "stay",
      kind: "stay",
      title: plan.stay.hotelName,
      handoffEligible: true,
      searchHint: hint(plan.stay.hotelName),
      source: null,
    });
  }

  for (const day of plan.days) {
    for (const item of day.items) {
      if (item.kind === "attraction") {
        items.push({
          itemId: item.id,
          kind: "attraction",
          title: item.title,
          handoffEligible: true,
          searchHint: hint(item.title),
          source: null,
        });
      } else if (item.kind === "meal") {
        if (item.place?.name) {
          items.push({
            itemId: item.id,
            kind: "meal",
            title: item.place.name,
            handoffEligible: true,
            searchHint: hint(item.place.name),
            source: null,
          });
        } else {
          items.push({
            itemId: item.id,
            kind: "meal",
            title: item.title,
            handoffEligible: false,
            ineligibilityReason:
              "Meal has no identifiable place; nothing to hand off.",
            source: null,
          });
        }
      } else if (item.kind === "stay") {
        items.push({
          itemId: item.id,
          kind: "stay",
          title: item.title,
          handoffEligible: true,
          searchHint: hint(item.title),
          source: null,
        });
      } else {
        items.push({
          itemId: item.id,
          kind: "note",
          title: item.title,
          handoffEligible: false,
          ineligibilityReason:
            "Informational item; nothing to book or hand off.",
          source: null,
        });
      }
    }
  }
  return items;
}

export function evaluateBookingReadiness(
  input: BookingReadinessInput,
): BookingReadinessEvaluation {
  const { plan, status, check } = input;
  const items = collectHandoffItems(plan);

  if (!(TRIP_STATUSES as readonly string[]).includes(status)) {
    return {
      readiness: "INVALID_STATE",
      tripStatus: status,
      reasons: [
        `Unknown trip status "${status.slice(0, 50)}". Expected one of: ${TRIP_STATUSES.join(", ")}.`,
      ],
      items: [],
    };
  }

  if (status === "ACTIVE") {
    return {
      readiness: "ALREADY_ACTIVE",
      tripStatus: status,
      reasons: [
        "Trip is already active; the pre-trip booking window has passed.",
      ],
      items,
    };
  }

  if (status === "COMPLETED") {
    return {
      readiness: "NOT_READY",
      tripStatus: status,
      reasons: ["Trip is already completed; nothing left to book."],
      items,
    };
  }

  if (status === "DRAFT" || status === "PLANNED" || status === "VERIFIED") {
    return {
      readiness: "NOT_READY",
      tripStatus: status,
      reasons: [
        `Trip is ${status}; approve the itinerary before booking or handoff.`,
      ],
      items,
    };
  }

  // APPROVED: check everything the architecture can reliably know.
  const reasons: string[] = [];

  if (!plan.destination || plan.destination.trim().length === 0) {
    reasons.push("Destination information is missing.");
  }
  if (
    plan.dateMode === "fixed" &&
    (!plan.startDate || !plan.endDate)
  ) {
    reasons.push(
      "Fixed-date trip is missing its start or end date.",
    );
  }
  if (items.filter((i) => i.handoffEligible).length === 0) {
    reasons.push(
      "Itinerary contains no actionable items to book or hand off.",
    );
  }
  const blockingProblems = check?.summary.problem ?? 0;
  if (blockingProblems > 0) {
    reasons.push(
      `${blockingProblems} blocking RealityCheck problem(s) must be resolved before booking or handoff.`,
    );
  }

  return {
    readiness: reasons.length === 0 ? "READY" : "NOT_READY",
    tripStatus: status,
    reasons,
    items,
  };
}
