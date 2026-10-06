import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import {
  BOOKING_DISCLAIMER,
  evaluateBookingReadiness,
} from "../../../../src/server/booking/readiness";
import { validateSelection } from "../../../../src/server/booking/selection";
import { bookingOptionSchema } from "../../../../src/server/booking/types";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 9 Prompt 2 option-selection endpoint (stateless receipt).
 * POST /api/trips/booking-select  { plan, status, itemId, option }
 *
 * Validates the resubmitted option for internal consistency against the
 * plan (eligible item, deterministic option id, evidence-bound http(s)
 * URL, sane timestamp) and returns an EXTERNAL-handoff receipt. Never
 * creates a booking confirmation; never fetches the URL — the browser
 * navigates via a normal user-initiated link.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  status: z.string().min(1).max(50),
  itemId: z.string().min(1).max(100),
  option: bookingOptionSchema,
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
      "Provide a valid TripPlan, lifecycle status, handoff item id, and discovered option.",
      400,
    );
  }

  try {
    // Selection is only meaningful on a trip that is still booking-ready.
    const readiness = evaluateBookingReadiness({
      plan: parsed.data.plan,
      status: parsed.data.status,
    });
    if (readiness.readiness !== "READY") {
      throw new ConflictError(
        `Option selection requires a READY trip; got ${readiness.readiness}.`,
      );
    }
    const selection = validateSelection(parsed.data);
    return NextResponse.json({
      ok: true,
      data: {
        selection,
        booking: { performed: false, bookingId: null, confirmationCode: null },
        disclaimer: BOOKING_DISCLAIMER,
      },
    });
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
    return errorResponse("INTERNAL_ERROR", "Option selection failed.", 500);
  }
}
