/**
 * Unit tests for deterministic fact comparators.
 * Pure function tests — synthetic values only, no network.
 */
import { describe, expect, it } from "vitest";
import {
  compareAddress,
  compareHotelPrice,
  compareOpenHours,
  compareOpenState,
  compareRating,
  compareReviews,
  detectsClosure,
  normalizeHours,
} from "../src/server/realitycheck/compare";

describe("compareRating", () => {
  it("matches within ±0.3", () => {
    expect(compareRating(4.7, 4.5).outcome).toBe("matched");
    expect(compareRating(4.7, 4.4).outcome).toBe("matched");
  });

  it("flags moves beyond tolerance as changed", () => {
    const res = compareRating(4.7, 4.2);
    expect(res.outcome).toBe("changed");
    expect(res.detail).toContain("4.7");
  });

  it("treats missing fresh data as missing, not contradictory", () => {
    expect(compareRating(4.7, undefined).outcome).toBe("missing");
    expect(compareRating(undefined, 4.5).outcome).toBe("missing");
  });
});

describe("compareReviews", () => {
  it("treats growth as matched", () => {
    expect(compareReviews(1000, 1500).outcome).toBe("matched");
  });

  it("tolerates small drops", () => {
    expect(compareReviews(1000, 900).outcome).toBe("matched");
  });

  it("flags drops beyond 20% as changed", () => {
    const res = compareReviews(1000, 500);
    expect(res.outcome).toBe("changed");
    expect(res.detail).toContain("1000");
  });

  it("ignores drops on tiny review bases", () => {
    expect(compareReviews(4, 3).outcome).toBe("matched");
  });

  it("treats missing data as missing", () => {
    expect(compareReviews(1000, undefined).outcome).toBe("missing");
  });
});

describe("compareHotelPrice", () => {
  it("matches moves within 5%", () => {
    expect(compareHotelPrice(10000, 10400).outcome).toBe("matched");
  });

  it("flags 5–15% moves as attention-level drift", () => {
    const res = compareHotelPrice(10000, 11000);
    expect(res.outcome).toBe("changed");
    expect(res.drift).toBe("attention");
  });

  it("flags moves beyond 15% as significant drift", () => {
    const res = compareHotelPrice(13041, 16500);
    expect(res.outcome).toBe("changed");
    expect(res.drift).toBe("significant");
  });

  it("treats missing fresh prices as missing", () => {
    expect(compareHotelPrice(10000, undefined).outcome).toBe("missing");
  });
});

describe("compareAddress", () => {
  it("matches equal and contained addresses", () => {
    expect(compareAddress("A, B", "a, b").outcome).toBe("matched");
    expect(compareAddress("123 Main St, Jaipur", "Main St").outcome).toBe(
      "matched",
    );
  });

  it("flags genuinely different addresses as changed", () => {
    expect(compareAddress("Jaipur", "Mumbai").outcome).toBe("changed");
  });

  it("treats missing data as missing", () => {
    expect(compareAddress("Jaipur", undefined).outcome).toBe("missing");
  });
});

describe("compareOpenState", () => {
  it("matches case-insensitively", () => {
    expect(compareOpenState("Open now", "open now").outcome).toBe("matched");
  });

  it("flags real changes", () => {
    expect(compareOpenState("Open now", "Closed").outcome).toBe("changed");
  });
});

describe("normalizeHours and compareOpenHours", () => {
  it("matches identical structured hours", () => {
    const hours = { monday: "9 am 5 pm" };
    expect(compareOpenHours(hours, { Monday: "9 AM 5 PM" }).outcome).toBe(
      "matched",
    );
  });

  it("flags differing structured days", () => {
    const res = compareOpenHours(
      { monday: "9 am 5 pm" },
      { monday: "10 am 4 pm" },
    );
    expect(res.outcome).toBe("changed");
    expect(res.detail).toContain("monday");
  });

  it("marks unstructured hours unverifiable instead of mismatched", () => {
    expect(
      compareOpenHours("9 AM - 5 PM", "10 AM - 4 PM").outcome,
    ).toBe("unverifiable");
    expect(compareOpenHours({ monday: "9 am" }, "closed").outcome).toBe(
      "unverifiable",
    );
  });

  it("marks absent hours missing", () => {
    expect(compareOpenHours(undefined, { monday: "9 am" }).outcome).toBe(
      "missing",
    );
  });

  it("normalizeHours rejects non-record shapes", () => {
    expect(normalizeHours(["Monday"]).comparable).toBe(false);
    expect(normalizeHours(42).comparable).toBe(false);
  });
});

describe("detectsClosure", () => {
  it("detects permanent closure signals", () => {
    expect(detectsClosure("Permanently closed")).toBe(true);
  });

  it("ignores ordinary states", () => {
    expect(detectsClosure("Open now")).toBe(false);
    expect(detectsClosure(undefined)).toBe(false);
  });
});
