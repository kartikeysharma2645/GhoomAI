import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { MAX_RECHECK_OPTIONS, runFinalRecheck } from "../../../../src/server/booking/recheck";
import { bookingOptionSchema } from "../../../../src/server/booking/types";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 9 Prompt 3 final pre-trip recheck endpoint.
 * POST /api/trips/booking-recheck  { plan: TripPlan, status: string, selections?: BookingOption[] }
 *
 * Verification-only orchestration around the existing RealityCheck engine:
 * requires APPROVED, runs a fresh bounded checkTrip (never trusts a
 * client-supplied check), and re-establishes freshness for each resubmitted
 * selected option. Never mutates the plan, never activates the trip, never
 * books. A CLEAR verdict means "freshly checked", not "booked".
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  status: z.string().min(1).max(50),
  selections: z.array(bookingOptionSchema).max(MAX_RECHECK_OPTIONS + 10).optional(),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: { httpStatus?: number; providerError?: string },
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
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
      "Provide a valid TripPlan, a lifecycle status string, and optional selected options.",
      400,
    );
  }

  try {
    const data = await runFinalRecheck(parsed.data);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: 409 },
      );
    }
    if (err instanceof ConfigurationError) {
      return errorResponse(
        err.code,
        "Search service is not configured. Set SERPAPI_KEY in the server environment.",
        500,
      );
    }
    if (err instanceof ValidationError) {
      return errorResponse(err.code, err.message, 400);
    }
    if (err instanceof UpstreamError) {
      const status = err.status === 429 ? 429 : 502;
      return errorResponse(err.code, err.message, status, err.details);
    }
    return errorResponse("INTERNAL_ERROR", "Final recheck failed.", 500);
  }
}
