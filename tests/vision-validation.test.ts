/**
 * Unit tests for server-side image validation (Phase 8 Prompt 1).
 * Synthetic byte buffers only — no real images, no network.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/lib/errors";
import {
  MAX_IMAGE_BYTES,
  sniffImageMime,
  validateImageInput,
} from "../src/server/vision/validation";

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function png(): Uint8Array {
  return new Uint8Array(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
  );
}

function webp(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

describe("sniffImageMime", () => {
  it("detects JPEG magic bytes", () => {
    expect(sniffImageMime(jpeg())).toBe("image/jpeg");
  });

  it("detects PNG magic bytes", () => {
    expect(sniffImageMime(png())).toBe("image/png");
  });

  it("detects WebP RIFF/WEBP markers", () => {
    expect(sniffImageMime(webp())).toBe("image/webp");
  });

  it("returns null for non-image bytes", () => {
    expect(sniffImageMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(null);
  });

  it("returns null for truncated magic", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBe(null);
  });
});

describe("validateImageInput", () => {
  it("accepts a valid JPEG", () => {
    const out = validateImageInput({ bytes: jpeg(), declaredMimeType: "image/jpeg" });
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("accepts a valid PNG", () => {
    const out = validateImageInput({ bytes: png(), declaredMimeType: "image/png" });
    expect(out.mimeType).toBe("image/png");
  });

  it("accepts a valid WebP", () => {
    const out = validateImageInput({ bytes: webp(), declaredMimeType: "image/webp" });
    expect(out.mimeType).toBe("image/webp");
  });

  it("accepts content when no MIME was declared", () => {
    const out = validateImageInput({ bytes: jpeg() });
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("rejects unsupported MIME types", () => {
    expect(() =>
      validateImageInput({
        bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
        declaredMimeType: "image/gif",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects empty uploads", () => {
    expect(() => validateImageInput({ bytes: new Uint8Array([]) })).toThrow(
      ValidationError,
    );
  });

  it("rejects oversized uploads", () => {
    expect(() =>
      validateImageInput({
        bytes: jpeg(),
        declaredMimeType: "image/jpeg",
        sizeBytes: MAX_IMAGE_BYTES + 1,
      }),
    ).toThrow(ValidationError);
  });

  it("rejects mismatched declared MIME types", () => {
    expect(() =>
      validateImageInput({ bytes: jpeg(), declaredMimeType: "image/png" }),
    ).toThrow(ValidationError);
  });
});
