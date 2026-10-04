import { NextResponse } from "next/server";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "@/src/lib/errors";
import { tripPlanRequestSchema } from "@/src/server/trips/requirements";
import { planTrip } from "@/src/server/trips/service";

/**
 * Phase 4 Step 1 trip planning endpoint (no history, no booking).
 * POST /api/trips/plan  { destination?, startDate?, ... }
 *
 * Thin handler: JSON parsing → Zod validation → planTrip() → safe response.
 * Returns `{ status: "needs_input", ... }` when requirements are incomplete.
 * Never accepts engine selection or API keys from the client.
 */
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

  const parsed = tripPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid trip request. Check destination, dates, travelers, and budget.",
      400,
    );
  }

  try {
    const result = await planTrip(parsed.data);
    return NextResponse.json({ ok: true, data: result });
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
    return errorResponse("INTERNAL_ERROR", "Trip planning failed.", 500);
  }
}
