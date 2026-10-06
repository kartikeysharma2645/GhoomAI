/**
 * Unit tests for the deterministic photography assistant (Phase 8 Prompt 3).
 * Pure function tests — no network. Synthetic fixtures only.
 */
import { describe, expect, it } from "vitest";
import {
  buildPhotographyAdvice,
  imageSpecificTips,
} from "../src/server/vision/photography";
import type { VisionCandidate } from "../src/server/vision/types";

function candidate(extra: Partial<VisionCandidate> = {}): VisionCandidate {
  return {
    name: "Synthetic Fort",
    type: "MONUMENT",
    confidence: 0.85,
    ...extra,
  };
}

describe("buildPhotographyAdvice", () => {
  it("builds monument advice for verified places", () => {
    const advice = buildPhotographyAdvice(candidate(), {
      verified: true,
      visualObservations: [],
    });
    expect(advice.subject).toBe("Synthetic Fort");
    expect(advice.groundedIn).toBe("verified_place");
    expect(advice.composition.length).toBeGreaterThan(0);
    expect(advice.poseSuggestions.length).toBeGreaterThan(0);
    expect(
      advice.caveats.some((c) => c.includes("public areas")),
    ).toBe(true);
  });

  it("marks unverified advice as visual-only", () => {
    const advice = buildPhotographyAdvice(candidate(), {
      verified: false,
      visualObservations: [],
    });
    expect(advice.groundedIn).toBe("visual_only");
    expect(
      advice.caveats.some((c) => c.includes("not verified")),
    ).toBe(true);
  });

  it("adapts to food subjects without poses", () => {
    const advice = buildPhotographyAdvice(
      { name: "Tasty Plate", type: "RESTAURANT", confidence: 0.7 },
      { verified: true, visualObservations: [] },
    );
    expect(advice.subjectCategory).toBe("food");
    expect(advice.poseSuggestions).toEqual([]);
    expect(
      advice.composition.some((c) => c.includes("45 degrees")),
    ).toBe(true);
  });

  it("adapts to landscapes and street scenes", () => {
    const landscape = buildPhotographyAdvice(
      { name: "Green Valley", type: "NATURAL_SITE", confidence: 0.7 },
      { verified: false, visualObservations: [] },
    );
    expect(landscape.subjectCategory).toBe("landscape");
    const street = buildPhotographyAdvice(
      { name: "Old Lane", type: "STREET", confidence: 0.7 },
      { verified: false, visualObservations: [] },
    );
    expect(
      street.composition.some((c) => c.toLowerCase().includes("candid")),
    ).toBe(true);
  });

  it("falls back to generic advice for unknown categories", () => {
    const advice = buildPhotographyAdvice(
      { name: "Mystery Thing", type: "UNKNOWN", confidence: 0.4 },
      { verified: false, visualObservations: [] },
    );
    expect(advice.subjectCategory).toBe("general");
    expect(advice.composition.length).toBeGreaterThan(0);
  });

  it("never claims camera metadata", () => {
    const advice = buildPhotographyAdvice(candidate(), {
      verified: true,
      visualObservations: [],
    });
    const all = [
      ...advice.composition,
      ...advice.framing,
      ...advice.cameraTips,
      ...advice.lighting,
    ].join(" ");
    expect(all).not.toMatch(/f\/[0-9]|\b1\/[0-9]+s\b|ISO\s*[0-9]|[0-9]+mm/i);
    expect(
      advice.cameraTips.some((c) => c.includes("No camera metadata")),
    ).toBe(true);
  });

  it("avoids unsafe suggestions", () => {
    const advice = buildPhotographyAdvice(candidate(), {
      verified: true,
      visualObservations: [],
    });
    const all = [...advice.poseSuggestions, ...advice.caveats].join(" ");
    expect(all).not.toMatch(/traffic|trespass|prohibited|climb|edge of/i);
  });
});

describe("imageSpecificTips", () => {
  it("notices centered subjects and clutter", () => {
    const tips = imageSpecificTips([
      "Monument centered in frame with a busy foreground crowd.",
    ]);
    expect(tips.some((t) => t.includes("off-center"))).toBe(true);
    expect(tips.some((t) => t.includes("clutter"))).toBe(true);
  });

  it("returns nothing for undescriptive observations", () => {
    expect(imageSpecificTips(["A photo."])).toEqual([]);
    expect(imageSpecificTips([])).toEqual([]);
  });
});
