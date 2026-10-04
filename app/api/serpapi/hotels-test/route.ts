import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "@/src/lib/errors";
import { SerpApiClient } from "@/src/server/services/serpapi/client";

/**
 * Phase 2 Step 3 connectivity test — NOT the final GhoomAI stays API.
 * GET /api/serpapi/hotels-test?q=...&check_in=...&check_out=...&adults=...&currency=...
 *
 * Uses the SerpApi Google Hotels engine (`engine=google_hotels`).
 * Default dates are generated dynamically per request (server date +30/+33
 * days) so they always satisfy client validation. Never hardcode dates.
 * Returns normalized hotels only. Never returns the API key or request URL.
 */
const DEFAULT_TEST_QUERY = "hotels in Jaipur";
const DEFAULT_CURRENCY = "INR";
const DEFAULT_CHECKIN_OFFSET_DAYS = 30;
const DEFAULT_STAY_LENGTH_DAYS = 3;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

const querySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  check_in: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "check_in must use YYYY-MM-DD.")
    .optional(),
  check_out: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "check_out must use YYYY-MM-DD.")
    .optional(),
  adults: z.coerce.number().int().min(1).max(16).optional(),
  currency: z.string().min(1).max(3).optional(),
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
      check_in: url.searchParams.get("check_in") ?? undefined,
      check_out: url.searchParams.get("check_out") ?? undefined,
      adults: url.searchParams.get("adults") ?? undefined,
      currency: url.searchParams.get("currency") ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid hotels-test parameters. Check q, dates (YYYY-MM-DD), adults, currency.",
        400,
      );
    }

    const defaultCheckIn = toIsoDate(
      addDays(new Date(), DEFAULT_CHECKIN_OFFSET_DAYS),
    );
    const defaultCheckOut = toIsoDate(
      addDays(
        new Date(),
        DEFAULT_CHECKIN_OFFSET_DAYS + DEFAULT_STAY_LENGTH_DAYS,
      ),
    );

    const client = new SerpApiClient();
    const data = await client.searchHotels({
      query: parsed.data.q ?? DEFAULT_TEST_QUERY,
      checkIn: parsed.data.check_in ?? defaultCheckIn,
      checkOut: parsed.data.check_out ?? defaultCheckOut,
      adults: parsed.data.adults ?? 2,
      currency: parsed.data.currency ?? DEFAULT_CURRENCY,
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
    return errorResponse("INTERNAL_ERROR", "Hotels search test failed.", 500);
  }
}
