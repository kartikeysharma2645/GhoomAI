import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../../src/lib/errors";
import { activeTripSchema } from "../../../../../../src/server/livetrip/activeTrip";
import { applyReschedule } from "../../../../../../src/server/livetrip/applyReschedule";
import { rescheduleProposalSchema } from "../../../../../../src/server/livetrip/reschedule";

/**
 * Live Trip reschedule-apply endpoint (explicit approval only).
 * POST /api/trips/active/reschedule/apply  { trip, proposal, changeIds }
 *
 * Thin handler: validate → applyReschedule → respond with the NEW
 * ActiveTrip. Application is atomic; staleness aborts with 409.
 * Fresh verification of the updated trip is a separate operation.
 */
const bodySchema = z.object({
  trip: activeTripSchema,
  proposal: rescheduleProposalSchema,
  changeIds: z.array(z.string().min(1)).min(1),
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
      "Provide a valid ActiveTrip, RescheduleProposal, and at least one changeId.",
      400,
    );
  }

  try {
    const data = applyReschedule(
      parsed.data.trip,
      parsed.data.proposal,
      parsed.data.changeIds,
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
    return errorResponse("INTERNAL_ERROR", "Reschedule apply failed.", 500);
  }
}
