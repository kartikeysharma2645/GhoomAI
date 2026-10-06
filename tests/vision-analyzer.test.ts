/**
 * Unit tests for VisionAnalyzer helpers (Phase 8 Prompt 1).
 * Pure function tests — component rendering is verified via build
 * and manual review, consistent with existing UI conventions.
 */
import { describe, expect, it } from "vitest";
import {
  isVisionUnavailable,
  parsePlaceResponse,
  parseVisionResponse,
  validateImageSelection,
  VISION_NOT_CONFIGURED_CODE,
} from "../app/components/VisionAnalyzer";

describe("validateImageSelection", () => {
  it("accepts a reasonable JPEG", () => {
    expect(
      validateImageSelection({ size: 1024, type: "image/jpeg" }),
    ).toBeNull();
  });

  it("rejects empty files", () => {
    expect(validateImageSelection({ size: 0, type: "image/png" })).toContain(
      "empty",
    );
  });

  it("rejects oversized files", () => {
    expect(
      validateImageSelection({ size: 9_000_000, type: "image/png" }),
    ).toContain("too large");
  });

  it("rejects unsupported types", () => {
    expect(validateImageSelection({ size: 100, type: "image/gif" })).toContain(
      "Unsupported",
    );
  });

  it("allows unknown types through to server validation", () => {
    expect(validateImageSelection({ size: 100, type: "" })).toBeNull();
  });
});

describe("parsePlaceResponse", () => {
  function okPlace(extra: Record<string, unknown> = {}) {
    return {
      ok: true,
      data: {
        verification: { status: "VERIFIED" },
        explanation: { summary: "s", culturalContext: "c", fullyVerified: true, sources: [] },
        nearby: [{ name: "Nearby Museum" }],
        warnings: [],
        ...extra,
      },
    };
  }

  it("accepts a verified place result", () => {
    const parsed = parsePlaceResponse(okPlace());
    expect(parsed?.verification.status).toBe("VERIFIED");
    expect(parsed?.nearby).toHaveLength(1);
  });

  it("accepts partial and unverified results", () => {
    const partial = parsePlaceResponse(
      okPlace({ verification: { status: "PARTIALLY_VERIFIED" } }),
    );
    expect(partial?.verification.status).toBe("PARTIALLY_VERIFIED");
    const unverified = parsePlaceResponse(
      okPlace({ verification: { status: "UNVERIFIED" } }),
    );
    expect(unverified?.verification.status).toBe("UNVERIFIED");
  });

  it("rejects malformed place payloads", () => {
    expect(parsePlaceResponse({ ok: true, data: {} })).toBeNull();
    expect(parsePlaceResponse({ ok: false })).toBeNull();
    expect(parsePlaceResponse(null)).toBeNull();
  });
});

describe("isVisionUnavailable", () => {
  it("detects the unconfigured-provider payload", () => {
    expect(
      isVisionUnavailable({
        ok: false,
        error: { code: VISION_NOT_CONFIGURED_CODE, message: "x" },
      }),
    ).toBe(true);
  });

  it("ignores other payloads", () => {
    expect(
      isVisionUnavailable({ ok: false, error: { code: "OTHER", message: "x" } }),
    ).toBe(false);
    expect(isVisionUnavailable({ ok: true, data: {} })).toBe(false);
    expect(isVisionUnavailable(null)).toBe(false);
  });
});

describe("parseVisionResponse", () => {
  function okResponse(extra: Record<string, unknown> = {}) {
    return {
      ok: true,
      data: {
        analysisId: "va_1",
        analyzedAt: "2026-10-05T00:00:00.000Z",
        status: "LIKELY",
        candidates: [{ name: "X", type: "MONUMENT", confidence: 0.7 }],
        visualObservations: [],
        warnings: [],
        ...extra,
      },
    };
  }

  it("accepts identified/likely results", () => {
    const parsed = parseVisionResponse(okResponse());
    expect(parsed?.candidates).toHaveLength(1);
  });

  it("accepts uncertain results", () => {
    const parsed = parseVisionResponse(
      okResponse({ status: "UNCERTAIN", candidates: [] }),
    );
    expect(parsed?.status).toBe("UNCERTAIN");
  });

  it("rejects failure payloads", () => {
    expect(
      parseVisionResponse({ ok: false, error: { message: "x" } }),
    ).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(parseVisionResponse({ ok: true, data: {} })).toBeNull();
    expect(parseVisionResponse(null)).toBeNull();
    expect(parseVisionResponse("oops")).toBeNull();
  });
});
