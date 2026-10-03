import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "@/src/lib/errors";
import { SerpApiClient } from "@/src/server/services/serpapi/client";

/**
 * Phase 2 Step 2 connectivity test — NOT the final GhoomAI discovery API.
 * GET /api/serpapi/maps-test?q=<query>&location=<optional location>
 *
 * Uses the SerpApi Google Maps Search engine (`engine=google_maps`,
 * `type=search`) with a safe default query.
 * Returns normalized places only. Never returns the API key or request URL.
 */
const DEFAULT_TEST_QUERY = "tourist attractions in Jaipur";
const DEFAULT_TEST_LOCATION = "Jaipur";

const querySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  location: z.string().min(1).max(200).optional(),
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      location: url.searchParams.get("location") ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Parameters 'q' and 'location' must each be 1-200 characters.",
        400,
      );
    }

    const client = new SerpApiClient();
    const data = await client.searchMaps({
      query: parsed.data.q ?? DEFAULT_TEST_QUERY,
      location: parsed.data.location ?? DEFAULT_TEST_LOCATION,
    });

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
    return errorResponse("INTERNAL_ERROR", "Maps search test failed.", 500);
  }
}
