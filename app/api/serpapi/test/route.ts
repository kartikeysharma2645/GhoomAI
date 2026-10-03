import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "@/src/lib/errors";
import { SerpApiClient } from "@/src/server/services/serpapi/client";

/**
 * Phase 2 connectivity test — NOT the final GhoomAI travel-search API.
 * GET /api/serpapi/test?q=<optional travel query>
 *
 * Uses the SerpApi Google Search engine with a safe default query.
 * Returns normalized results only. Never returns the API key or request URL.
 */
const DEFAULT_TEST_QUERY = "best places to visit Jaipur";

const querySchema = z.object({
  q: z.string().min(1).max(200).optional(),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Query parameter 'q' must be 1-200 characters.",
        400,
      );
    }

    const client = new SerpApiClient();
    const data = await client.search({
      engine: "google",
      query: parsed.data.q ?? DEFAULT_TEST_QUERY,
      num: 10,
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
      return errorResponse(err.code, err.message, status);
    }
    return errorResponse("INTERNAL_ERROR", "Search test failed.", 500);
  }
}
