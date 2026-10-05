import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../src/lib/errors";
import { activeTripSchema } from "../../../../../src/server/livetrip/activeTrip";
import { liveSituationResultSchema } from "../../../../../src/server/livetrip/situation";
import { proposeReschedule } from "../../../../../src/server/livetrip/reschedule";

/**
 * Live Trip reschedule-proposal endpoint (proposal only, no apply).
 * POST /api/trips/active/reschedule  { trip, liveCheck }
 *
 * Thin handler: validate → proposeReschedule → respond. The submitted
 * trip and live check are only read; nothing is modified or applied.
 * A later approval step consumes the returned proposal.
 */
const bodySchema = z.object({
  trip: activeTripSchema,
  liveCheck: liveSituationResultSchema,
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
      "Provide a valid ActiveTrip and LiveSituationResult.",
      400,
    );
  }

  try {
    const data = await proposeReschedule(parsed.data);
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
    return errorResponse("INTERNAL_ERROR", "Reschedule proposal failed.", 500);
  }
}
