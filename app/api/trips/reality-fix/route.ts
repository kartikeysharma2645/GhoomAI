import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { fixTrip } from "../../../../src/server/realitycheck/fixer";
import { realityCheckResultSchema } from "../../../../src/server/realitycheck/checks";
import { tripPlanSchema } from "../../../../src/server/trips/plan";
import { tripRequirementsSchema } from "../../../../src/server/trips/requirements";

/**
 * Phase 5 Step 3 fix-proposal endpoint (proposal only, no auto-apply).
 * POST /api/trips/reality-fix  { plan, check, requirements? }
 *
 * Thin handler: validate → fixTrip → respond. Returns a ReplanProposal
 * the user may later approve; the submitted TripPlan is never modified.
 * Never exposes raw SerpApi payloads or API keys.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  check: realityCheckResultSchema,
  requirements: tripRequirementsSchema.optional(),
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
      "Provide a valid TripPlan and RealityCheckResult.",
      400,
    );
  }

  try {
    const proposal = await fixTrip(parsed.data);
    return NextResponse.json({ ok: true, data: proposal });
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
    return errorResponse("INTERNAL_ERROR", "Fix proposal failed.", 500);
  }
}
