/**
 * Unit tests for deterministic candidate scoring.
 * Pure function tests — synthetic fixtures only, no network.
 */
import { describe, expect, it } from "vitest";
import {
  scorePlace,
  type ScoreContext,
} from "../src/server/planning/scoring";
import type { NormalizedMapsPlace } from "../src/server/services/serpapi/types";

function place(
  title: string,
  rating?: number,
  reviews?: number,
  placeType?: string,
): NormalizedMapsPlace {
  return {
    position: 1,
    title,
    ...(rating !== undefined ? { rating } : {}),
    ...(reviews !== undefined ? { reviews } : {}),
    ...(placeType ? { placeType } : {}),
  };
}

function ctx(extra: Partial<ScoreContext> = {}): ScoreContext {
  return {
    interests: [],
    scheduledTypesToday: new Set(),
    scheduledKeys: new Set(),
    ...extra,
  };
}

describe("candidate scoring", () => {
  it("orders higher-rated places first", () => {
    const a = scorePlace(place("A", 4.8, 100), 0, ctx());
    const b = scorePlace(place("B", 4.1, 100), 1, ctx());
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("rewards review volume on rating ties", () => {
    const a = scorePlace(place("A", 4.5, 50000), 0, ctx());
    const b = scorePlace(place("B", 4.5, 50), 1, ctx());
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons).toContain("high review volume");
  });

  it("adds an interest bonus with a reason", () => {
    const scored = scorePlace(
      place("Synthetic Fort", 4.0, 100, "Fort"),
      0,
      ctx({ interests: ["history"] }),
    );
    const plain = scorePlace(place("Synthetic Fort", 4.0, 100, "Fort"), 0, ctx());
    expect(scored.score).toBeGreaterThan(plain.score);
    expect(scored.reasons).toContain("matches history interest");
  });

  it("penalizes categories already scheduled today", () => {
    const penalized = scorePlace(
      place("Museum B", 4.5, 100, "Museum"),
      0,
      ctx({ scheduledTypesToday: new Set(["museum"]) }),
    );
    const clean = scorePlace(place("Museum B", 4.5, 100, "Museum"), 0, ctx());
    expect(penalized.score).toBeLessThan(clean.score);
    expect(penalized.reasons).toContain(
      "same category already scheduled today",
    );
  });

  it("penalizes already-scheduled places", () => {
    const repeated = scorePlace(
      place("A", 4.5, 100),
      0,
      ctx({ scheduledKeys: new Set(["A"]) }),
    );
    const fresh = scorePlace(place("A", 4.5, 100), 0, ctx());
    expect(repeated.score).toBeLessThan(fresh.score);
    expect(repeated.reasons).toContain("already scheduled");
  });

  it("handles missing ratings and reviews safely", () => {
    const scored = scorePlace(place("Unknown Place"), 0, ctx());
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.score).toBe(0);
    expect(scored.reasons).toEqual([]);
  });

  it("never produces NaN or Infinity", () => {
    const scored = scorePlace(
      place("Extreme", 5, 1_000_000_000, "Fort"),
      0,
      ctx({ interests: ["history"] }),
    );
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.score).toBeGreaterThan(0);
  });
});
