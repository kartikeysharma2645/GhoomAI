import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../src/lib/errors";
import { askContextSchema, resolveIntent } from "../../../src/server/agent/intent";
import { executeIntent } from "../../../src/server/agent/responder";

/**
 * Phase 3 GhoomAI interaction endpoint (single-turn, no history).
 * POST /api/ask  { message, context? }
 *
 * Thin handler: validate → resolveIntent → responder → response.
 * Engine selection comes from resolveIntent() only — the client can never
 * choose an engine or supply an API key. Unknown body fields are stripped.
 */
const bodySchema = z.object({
  message: z.string().min(1).max(500),
  context: askContextSchema.optional(),
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
      "Provide a non-empty message of at most 500 characters.",
      400,
    );
  }

  try {
    const intent = resolveIntent(
      parsed.data.message,
      parsed.data.context ?? {},
    );
    const data = await executeIntent(intent);
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
    return errorResponse("INTERNAL_ERROR", "Assistant request failed.", 500);
  }
}
