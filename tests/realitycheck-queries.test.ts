/**
 * Unit tests for deterministic verification query builders and matchers.
 * Pure function tests — synthetic values only, no network.
 */
import { describe, expect, it } from "vitest";
import {
  buildHotelQuery,
  buildPlaceQuery,
  dedupeKey,
  matchHotel,
  matchPlace,
  normalizeName,
} from "../src/server/realitycheck/queries";

describe("query builders", () => {
  it("builds deterministic Maps queries", () => {
    expect(buildPlaceQuery("Amber Palace", "Jaipur")).toEqual({
      engine: "google_maps",
      query: "Amber Palace Jaipur",
      location: "Jaipur",
    });
  });

  it("builds hotel queries with exact trip context", () => {
    expect(
      buildHotelQuery({
        hotelName: "Synthetic Grand",
        destination: "Jaipur",
        checkIn: "2026-11-10",
        checkOut: "2026-11-13",
        adults: 2,
        children: 0,
        currency: "INR",
      }),
    ).toEqual({
      engine: "google_hotels",
      query: "Synthetic Grand",
      checkIn: "2026-11-10",
      checkOut: "2026-11-13",
      adults: 2,
      children: 0,
      childrenAges: undefined,
      currency: "INR",
    });
  });

  it("prioritizes stable IDs in dedupe keys", () => {
    expect(
      dedupeKey({ propertyToken: "tok", placeId: "pid" }, "Name", "D"),
    ).toBe("hotel:tok");
    expect(
      dedupeKey({ propertyToken: undefined, placeId: "pid" }, "Name", "D"),
    ).toBe("place:pid");
    expect(dedupeKey({}, "Amber Palace", "Jaipur")).toBe(
      "name:amber palace jaipur",
    );
  });
});

describe("matchPlace", () => {
  const candidates = [
    { position: 1, title: "Amber Palace", placeId: "ChX1" },
    { position: 2, title: "City Palace" },
  ];

  it("matches confidently on stable placeId", () => {
    const res = matchPlace(candidates, { placeId: "ChX1" }, "Wrong Name");
    expect(res.matched).toBe(true);
    if (res.matched) {
      expect(res.confident).toBe(true);
      expect(res.place.title).toBe("Amber Palace");
    }
  });

  it("falls back to normalized name matching", () => {
    const res = matchPlace(candidates, {}, "city palace!");
    expect(res.matched).toBe(true);
    if (res.matched) expect(res.confident).toBe(false);
  });

  it("returns no match for ambiguous candidates", () => {
    expect(matchPlace(candidates, {}, "Unknown Place").matched).toBe(false);
    expect(matchPlace(candidates, { placeId: "ChX9" }, "Unknown").matched).toBe(
      false,
    );
  });
});

describe("matchHotel", () => {
  const candidates = [
    { position: 1, name: "Synthetic Grand", propertyToken: "tok1" },
    { position: 2, name: "Other Inn" },
  ];

  it("matches confidently on propertyToken", () => {
    const res = matchHotel(candidates, { propertyToken: "tok1" }, "Wrong");
    expect(res.matched).toBe(true);
    if (res.matched) expect(res.confident).toBe(true);
  });

  it("falls back to normalized name matching", () => {
    const res = matchHotel(candidates, {}, "other inn");
    expect(res.matched).toBe(true);
    if (res.matched) expect(res.confident).toBe(false);
  });

  it("returns no match otherwise", () => {
    expect(matchHotel(candidates, {}, "Missing").matched).toBe(false);
  });
});

describe("normalizeName", () => {
  it("normalizes deterministically", () => {
    expect(normalizeName("  Amber-Palace! ")).toBe("amber palace");
  });
});
