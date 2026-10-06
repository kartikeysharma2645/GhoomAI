import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { analyzeVisualPlace } from "../../../../src/server/vision/placeAnalysis";
import { MAX_IMAGE_BYTES } from "../../../../src/server/vision/validation";

/**
 * Visual place analysis endpoint (Phase 8 Prompt 2).
 * POST /api/vision/place  multipart/form-data { image, city?, country? }
 *
 * Full pipeline: vision identification → SerpApi Search + Maps
 * verification → grounded explanation → nearby discovery.
 * Visual confidence never implies verification; only agreeing live
 * evidence produces VERIFIED.
 */
const IMAGE_FIELD = "image";

const bodyHintsSchema = z.object({
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body must be multipart form data with an image field.",
      400,
    );
  }

  const file = form.get(IMAGE_FIELD);
  if (!(file instanceof Blob)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Provide an image file in the image field (JPEG, PNG, or WebP).",
      400,
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return errorResponse(
      "VALIDATION_ERROR",
      `Uploaded image exceeds the ${MAX_IMAGE_BYTES}-byte limit.`,
      413,
    );
  }

  const hints = bodyHintsSchema.safeParse({
    city:
      typeof form.get("city") === "string"
        ? (form.get("city") as string)
        : undefined,
    country:
      typeof form.get("country") === "string"
        ? (form.get("country") as string)
        : undefined,
  });
  if (!hints.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Optional city/country hints must be short text.",
      400,
    );
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const data = await analyzeVisualPlace({
      bytes: buffer,
      declaredMimeType: file.type || undefined,
      sizeBytes: file.size,
      cityHint: hints.data.city,
      countryHint: hints.data.country,
    });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return errorResponse(
        err.code,
        "Visual place analysis is not configured. Identification is currently unavailable.",
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
    return errorResponse("INTERNAL_ERROR", "Visual place analysis failed.", 500);
  }
}
