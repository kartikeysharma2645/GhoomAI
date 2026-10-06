import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { discoverBookingOptions } from "../../../../src/server/booking/discovery";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 9 Prompt 2 live booking-option discovery endpoint.
 * POST /api/trips/booking-discover  { plan: TripPlan, status: string }
 *
 * Server-side only: the SerpApi key never leaves the gateway. Requires an
 * APPROVED trip (409 otherwise). Runs bounded live discovery (google_maps /
 * google_hotels / google search through the existing client) and returns
 * evidence-backed EXTERNAL options — never a booking, never prices or
 * availability, never fabricated URLs.
 *
 * Failure contract: per-item SEARCH_FAILED entries keep partial results
 * alive. Only when EVERY search fails does the gateway error propagate
 * (502/429/500) instead of a fake empty success.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  status: z.string().min(1).max(50),
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
      "Provide a valid TripPlan and a lifecycle status string.",
      400,
    );
  }

  try {
    const data = await discoverBookingOptions(parsed.data);
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
    return errorResponse("INTERNAL_ERROR", "Booking discovery failed.", 500);
  }
}
