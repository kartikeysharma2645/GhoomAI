import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../src/lib/errors";
import {
  confirmPayloadSchema,
  orchestrateTurn,
} from "../../../src/server/agent/orchestrator";
import { conversationSessionSchema } from "../../../src/server/agent/session";
import { MAX_IMAGE_BYTES } from "../../../src/server/vision/validation";

/**
 * Phase 10 Prompt 2 conversational agent endpoint (orchestration, no UI).
 * POST /api/agent  { session, message, confirm?, imageBase64?, imageMimeType? }
 *
 * Thin handler: validate → orchestrateTurn → typed response. Exactly one
 * capability action executes per turn; consequential actions additionally
 * require an explicit confirm payload matching recorded pendingConfirmation.
 * Images are decoded in memory, never stored in the session, never logged.
 * The SerpApi key never leaves the server-side service layer.
 */
const bodySchema = z.object({
  session: conversationSessionSchema,
  message: z.string().min(1).max(500),
  confirm: confirmPayloadSchema.optional(),
  imageBase64: z.string().min(1).max(12_000_000).optional(),
  imageMimeType: z.string().min(1).max(50).optional(),
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
      "Provide a valid session, a message of at most 500 characters, and optional confirmation or image payloads.",
      400,
    );
  }

  let image: { bytes: Uint8Array; mimeType?: string } | undefined;
  if (parsed.data.imageBase64 !== undefined) {
    let bytes: Uint8Array;
    try {
      const buffer = Buffer.from(parsed.data.imageBase64, "base64");
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      return errorResponse(
        "VALIDATION_ERROR",
        "Image payload must be valid base64.",
        400,
      );
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return errorResponse(
        "VALIDATION_ERROR",
        `Uploaded image exceeds the ${MAX_IMAGE_BYTES}-byte limit.`,
        413,
      );
    }
    image = {
      bytes,
      ...(parsed.data.imageMimeType
        ? { mimeType: parsed.data.imageMimeType }
        : {}),
    };
  }

  try {
    const data = await orchestrateTurn(
      parsed.data.session,
      parsed.data.message,
      parsed.data.confirm,
      ...(image ? [{ image }] : []),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return errorResponse(
        err.code,
        "A required service is not configured on the server.",
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
    return errorResponse("INTERNAL_ERROR", "Agent turn failed.", 500);
  }
}
