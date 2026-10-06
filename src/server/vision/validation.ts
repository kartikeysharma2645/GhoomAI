import { ValidationError } from "../../lib/errors";

/**
 * Server-side image input validation (Phase 8 Prompt 1).
 *
 * Accepts JPEG, PNG, and WebP only. Never trusts the filename or the
 * declared MIME type alone: the file's magic bytes must match an
 * allowlisted format. Images are processed in memory and never stored.
 */

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

/** Rejects large uploads before they consume provider time/memory. */
export const MAX_IMAGE_BYTES = 8_000_000;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function isWebP(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

/** Sniffs the true format from magic bytes, regardless of declared type. */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (isWebP(bytes)) return "image/webp";
  return null;
}

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: AllowedImageMime;
  sizeBytes: number;
}

/**
 * Validates raw upload bytes. Throws ValidationError describing the
 * first problem found. Never logs image contents.
 */
export function validateImageInput(input: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  sizeBytes?: number;
}): ValidatedImage {
  const { bytes, declaredMimeType, sizeBytes } = input;
  const size = sizeBytes ?? bytes.length;

  if (!bytes || bytes.length === 0 || size === 0) {
    throw new ValidationError("Uploaded image is empty.");
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new ValidationError(
      `Uploaded image exceeds the ${MAX_IMAGE_BYTES}-byte limit.`,
    );
  }

  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw new ValidationError(
      "Uploaded file is not a supported image (JPEG, PNG, or WebP).",
    );
  }
  if (declaredMimeType && declaredMimeType !== sniffed) {
    throw new ValidationError(
      "Declared file type does not match the image contents.",
    );
  }

  return { bytes, mimeType: sniffed, sizeBytes: size };
}
