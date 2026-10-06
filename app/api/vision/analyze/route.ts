import { NextResponse } from "next/server";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../../../../src/lib/errors";
import { analyzeImage } from "../../../../src/server/vision/service";
import { MAX_IMAGE_BYTES } from "../../../../src/server/vision/validation";

/**
 * Vision analysis endpoint (Phase 8 Prompt 1 — identification only).
 * POST /api/vision/analyze  multipart/form-data { image }
 *
 * Thin handler: extract upload → analyzeImage → respond. The uploaded
 * image is processed in memory and never stored; it is never echoed
 * back and never logged. No verification happens here (Prompt 2).
 */
const IMAGE_FIELD = "image";

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

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const data = await analyzeImage({
      bytes: buffer,
      declaredMimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return errorResponse(
        err.code,
        "Vision analysis is not configured. Image identification is currently unavailable.",
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
    return errorResponse("INTERNAL_ERROR", "Image analysis failed.", 500);
  }
}
