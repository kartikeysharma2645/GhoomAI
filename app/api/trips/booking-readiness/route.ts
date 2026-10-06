import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "../../../../src/lib/errors";
import {
  BOOKING_DISCLAIMER,
  evaluateBookingReadiness,
} from "../../../../src/server/booking/readiness";
import { bookingReadinessResponseSchema } from "../../../../src/server/booking/types";
import { realityCheckResultSchema } from "../../../../src/server/realitycheck/checks";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 9 Prompt 1 booking-readiness endpoint (foundation only).
 * POST /api/trips/booking-readiness  { plan: TripPlan, status: string, check?: RealityCheckResult }
 *
 * GhoomAI is stateless (the client holds the plan), so the "trip identifier"
 * is the plan itself plus its current lifecycle status — validated with the
 * existing tripPlanSchema and the lifecycle status set. No parallel
 * lifecycle, no persistence, no SerpApi call: readiness is deterministic.
 *
 * Never performs a booking and never claims one succeeded: `booking.performed`
 * is always false with null confirmation fields, and the response carries no
 * prices, availability, URLs, or booking IDs.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  status: z.string().min(1).max(50),
  check: realityCheckResultSchema.optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body must be valid JSON.",
      400,
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Provide a valid TripPlan, a lifecycle status string, and an optional RealityCheck result.",
      400,
    );
  }

  try {
    const evaluation = evaluateBookingReadiness(parsed.data);
    const data = bookingReadinessResponseSchema.parse({
      ...evaluation,
      booking: { performed: false, bookingId: null, confirmationCode: null },
      disclaimer: BOOKING_DISCLAIMER,
    });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.code, err.message, 400);
    }
    return errorResponse(
      "INTERNAL_ERROR",
      "Booking readiness evaluation failed.",
      500,
    );
  }
}
