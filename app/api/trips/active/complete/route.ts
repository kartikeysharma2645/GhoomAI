import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../src/lib/errors";
import { activeTripSchema } from "../../../../../src/server/livetrip/activeTrip";
import { completeTrip } from "../../../../../src/server/livetrip/progress";

/**
 * Live Trip completion endpoint (explicit user action only).
 * POST /api/trips/active/complete  { trip }
 *
 * Moves ACTIVE → COMPLETED. Rejected with 409 while real itinerary items
 * remain UPCOMING or IN_PROGRESS. The trip is never auto-completed.
 */
const bodySchema = z.object({
  trip: activeTripSchema,
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
      "Provide a valid ActiveTrip.",
      400,
    );
  }

  try {
    const data = completeTrip(parsed.data.trip);
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
    return errorResponse("INTERNAL_ERROR", "Trip completion failed.", 500);
  }
}
