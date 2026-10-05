import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { activateTrip } from "../../../../src/server/livetrip/activeTrip";
import { activatableStatusSchema } from "../../../../src/server/livetrip/lifecycle";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 6 Step 1 trip activation endpoint (no tracking yet).
 * POST /api/trips/activate  { plan, fromStatus }
 *
 * Thin handler: validate → activateTrip → respond. Activation is explicit
 * and deliberate: nothing auto-activates. The returned ActiveTrip carries
 * a deep-copied itinerary baseline; the submitted plan is never mutated.
 * No persistence yet — the client holds the returned state.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  fromStatus: activatableStatusSchema,
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
      "Provide a valid TripPlan and an activatable status (VERIFIED or APPROVED).",
      400,
    );
  }

  try {
    const data = activateTrip(parsed.data.plan, parsed.data.fromStatus);
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
    return errorResponse("INTERNAL_ERROR", "Trip activation failed.", 500);
  }
}
