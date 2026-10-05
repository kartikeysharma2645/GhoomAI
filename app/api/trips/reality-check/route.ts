import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { checkTrip } from "../../../../src/server/realitycheck/service";
import { tripPlanSchema } from "../../../../src/server/trips/plan";

/**
 * Phase 5 Step 1 RealityCheck verification endpoint (no fixing).
 * POST /api/trips/reality-check  { plan: TripPlan }
 *
 * Thin handler: JSON parsing → TripPlan validation → checkTrip() →
 * separate RealityCheckResult. The submitted TripPlan is never mutated.
 * Never exposes raw SerpApi payloads or API keys.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
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
      "Provide a valid TripPlan under the 'plan' key.",
      400,
    );
  }

  try {
    const data = await checkTrip(parsed.data.plan);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
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
    return errorResponse("INTERNAL_ERROR", "Reality check failed.", 500);
  }
}
