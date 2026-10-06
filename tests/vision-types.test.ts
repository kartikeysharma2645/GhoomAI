/**
 * Unit tests for the vision domain contract (Phase 8 Prompt 1).
 * Pure schema tests — no network, no provider.
 */
import { describe, expect, it } from "vitest";
import { visionAnalysisResultSchema } from "../src/server/vision/types";

function validResult(extra: Record<string, unknown> = {}) {
  return {
    analysisId: "va_test",
    analyzedAt: "2026-10-05T00:00:00.000Z",
    status: "LIKELY",
    candidates: [
      { name: "Amber Palace", type: "MONUMENT", confidence: 0.72 },
    ],
    visualObservations: ["Sandstone fort on a hill."],
    warnings: [],
    ...extra,
  };
}

describe("visionAnalysisResult", () => {
  it("accepts a valid result", () => {
    expect(visionAnalysisResultSchema.safeParse(validResult()).success).toBe(
      true,
    );
  });

  it("rejects confidence above 1", () => {
    const res = validResult({
      candidates: [{ name: "X", confidence: 1.5 }],
    });
    expect(visionAnalysisResultSchema.safeParse(res).success).toBe(false);
  });

  it("rejects negative confidence", () => {
    const res = validResult({
      candidates: [{ name: "X", confidence: -0.1 }],
    });
    expect(visionAnalysisResultSchema.safeParse(res).success).toBe(false);
  });

  it("rejects unknown statuses", () => {
    const res = validResult({ status: "DEFINITELY" });
    expect(visionAnalysisResultSchema.safeParse(res).success).toBe(false);
  });

  it("allows empty candidates (honest uncertainty)", () => {
    const res = validResult({ status: "UNIDENTIFIED", candidates: [] });
    const parsed = visionAnalysisResultSchema.safeParse(res);
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed candidates", () => {
    const res = validResult({ candidates: [{ confidence: 0.5 }] });
    expect(visionAnalysisResultSchema.safeParse(res).success).toBe(false);
  });

  it("rejects unknown subject types", () => {
    const res = validResult({
      candidates: [{ name: "X", type: "SPACESHIP", confidence: 0.5 }],
    });
    expect(visionAnalysisResultSchema.safeParse(res).success).toBe(false);
  });
});
