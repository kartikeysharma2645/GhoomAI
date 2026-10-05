import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConflictError,
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../../src/lib/errors";
import { applyReplanProposal } from "../../../../../src/server/realitycheck/apply";
import { replanProposalSchema } from "../../../../../src/server/realitycheck/proposal";
import { tripPlanSchema } from "../../../../../src/server/trips/plan";

/**
 * Phase 5 Step 4 apply endpoint (no auto-verify).
 * POST /api/trips/reality-fix/apply  { plan, proposal, changeIds }
 *
 * Thin handler: validate → applyReplanProposal → respond with the NEW
 * TripPlan. Application is atomic: any incompatibility aborts with 409
 * and nothing applies. Fresh verification is a separate operation.
 */
const bodySchema = z.object({
  plan: tripPlanSchema,
  proposal: replanProposalSchema,
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
      "Provide a valid TripPlan, ReplanProposal, and at least one changeId.",
      400,
    );
  }

  try {
    const result = applyReplanProposal(
      parsed.data.plan,
      parsed.data.proposal,
      parsed.data.changeIds,
    );
    return NextResponse.json({ ok: true, data: result });
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
    return errorResponse("INTERNAL_ERROR", "Apply fix failed.", 500);
  }
}
