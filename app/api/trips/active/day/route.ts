import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../src/lib/errors";
import { activeTripSchema } from "../../../../../src/server/livetrip/activeTrip";
import { setCurrentDay } from "../../../../../src/server/livetrip/progress";

/**
 * Live Trip current-day endpoint (explicit user control only).
 * POST /api/trips/active/day  { trip, dayNumber }
 *
 * Changes which itinerary day the trip is on. Viewing a different day
 * stays client-side; this endpoint moves the trip itself.
 */
const bodySchema = z.object({
  trip: activeTripSchema,
  dayNumber: z.number().int().min(1),
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
      "Provide a valid ActiveTrip and dayNumber.",
      400,
    );
  }

  try {
    const data = setCurrentDay(parsed.data.trip, parsed.data.dayNumber);
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
    return errorResponse("INTERNAL_ERROR", "Day change failed.", 500);
  }
}
