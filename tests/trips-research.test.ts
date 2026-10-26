/**
 * Unit tests for interest-aware place research and destination research.
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * EMPTY normalized shapes — request construction is asserted, never data.
 */
import { describe, expect, it, vi } from "vitest";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import type { TripInterest } from "../src/server/interests";
import { researchDestination } from "../src/server/research/destination";
import { researchPlaces } from "../src/server/research/places";
import type { TripRequirements } from "../src/server/trips/requirements";

function requirements(
  extra: Partial<TripRequirements> = {},
): TripRequirements {
  return {
    destination: "Jaipur",
    dateMode: "fixed",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    durationDays: 3,
    adults: 2,
    children: 0,
    interests: [],
    pace: "balanced",
    ...extra,
  };
}

function fakeClient() {
  return {
    searchMaps: vi.fn().mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: 4,
      results: [
        { title: "Place A", rating: 4.5 },
        { title: "Place B", rating: 4.2 },
        { title: "Place C", rating: 4.0 },
        { title: "Place D", rating: 3.8 },
      ],
    }),
    search: vi.fn().mockResolvedValue({
      engine: "google",
      query: "q",
      resultCount: 0,
      results: [],
    }),
    searchHotels: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

function queriesOf(fake: ReturnType<typeof fakeClient>): string[] {
  return fake.searchMaps.mock.calls.map(
    (c) => (c[0] as { query: string }).query,
  );
}

describe("interest-aware research", () => {
  const cases: Array<[TripInterest, string]> = [
    ["history", "historic sites in Jaipur"],
    ["food", "restaurants in Jaipur"],
    ["photography", "viewpoints in Jaipur"],
    ["nature", "parks in Jaipur"],
    ["shopping", "markets in Jaipur"],
    ["nightlife", "nightlife in Jaipur"],
  ];

  for (const [interest, expectedQuery] of cases) {
    it(`maps ${interest} to "${expectedQuery}"`, async () => {
      const fake = fakeClient();
      await researchPlaces(
        asClient(fake),
        requirements({ interests: [interest] }),
      );
      expect(queriesOf(fake)).toContain(expectedQuery);
    });
  }

  it("always researches restaurants regardless of interests", async () => {
    const fake = fakeClient();
    await researchPlaces(asClient(fake), requirements({ interests: ["history"] }));
    const queries = queriesOf(fake);
    expect(queries.some((q) => q.includes("restaurants"))).toBe(true);
    expect(queries).toContain("tourist attractions in Jaipur");
    expect(queries).toContain("historic sites in Jaipur");
  });

  it("caps at one interest query beyond attractions and food", async () => {
    const fake = fakeClient();
    const res = await researchPlaces(
      asClient(fake),
      requirements({ interests: ["food", "shopping", "nature"] }),
    );
    expect(fake.searchMaps).toHaveBeenCalledTimes(3);
    expect(res.interestExtraLabel).toBe("shopping");
  });
});

describe("destination research", () => {
  it("queries once with a bounded guide query", async () => {
    const fake = fakeClient();
    const res = await researchDestination(asClient(fake), "Jaipur");
    expect(fake.search).toHaveBeenCalledTimes(1);
    const arg = fake.search.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.query).toBe("Jaipur travel guide");
    expect(arg.num).toBe(5);
    expect(res.summary).toEqual([]);
    expect(res.sources).toEqual([]);
  });
});
