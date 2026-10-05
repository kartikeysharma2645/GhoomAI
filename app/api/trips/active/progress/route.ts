import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../src/lib/errors";
import {
  activeTripSchema,
  ITEM_PROGRESS_STATUSES,
} from "../../../../../src/server/livetrip/activeTrip";
import { updateItemProgress } from "../../../../../src/server/livetrip/progress";

/**
 * Live Trip item-progress endpoint (no tracking automation).
 * POST /api/trips/active/progress  { trip, dayNumber, itemId, toStatus }
 *
 * The client holds the ActiveTrip snapshot and submits it for mutation;
 * the server validates everything and returns a NEW trip. No persistence
 * yet — stateless by design.
 */
const bodySchema = z.object({
  trip: activeTripSchema,
  dayNumber: z.number().int().min(1),
  itemId: z.string().min(1).max(100),
  toStatus: z.enum(ITEM_PROGRESS_STATUSES),
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
      "Provide a valid ActiveTrip, dayNumber, itemId, and toStatus.",
      400,
    );
  }

  try {
    const data = updateItemProgress(
      parsed.data.trip,
      parsed.data.dayNumber,
      parsed.data.itemId,
      parsed.data.toStatus,
    );
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
    return errorResponse("INTERNAL_ERROR", "Progress update failed.", 500);
  }
}
