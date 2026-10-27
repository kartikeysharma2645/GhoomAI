/**
 * Unit tests for interest-aware place research and destination research.
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * EMPTY normalized shapes — request construction is asserted, never data.
 */
import { describe, expect, it, vi } from "vitest";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import type { TripInterest } from "../src/server/interests";
import {
  extractCityContext,
  rankPlacesByRelevance,
  researchPlaces,
} from "../src/server/research/places";
import { researchDestination } from "../src/server/research/destination";
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

describe("extractCityContext", () => {
  it("returns full destination for plain city names", () => {
    expect(extractCityContext("Jaipur")).toBe("Jaipur");
    expect(extractCityContext("New York")).toBe("New York");
  });

  it("extracts city/region after comma for specific venues", () => {
    expect(extractCityContext("Salt Marsh Nature Center, Brooklyn")).toBe(
      "Brooklyn",
    );
    expect(extractCityContext("Red Fort, Delhi, India")).toBe("India");
    expect(extractCityContext("Eiffel Tower, Paris")).toBe("Paris");
  });

  it("returns undefined for empty input", () => {
    expect(extractCityContext("")).toBeUndefined();
    expect(extractCityContext("   ")).toBeUndefined();
  });
});

describe("restaurant fallback behavior", () => {
  it("tries restaurant fallbacks when primary returns too few results", async () => {
    const calls: Array<{ query: string }> = [];
    const fake = {
      searchMaps: vi.fn().mockImplementation(async (params: { query: string }) => {
        calls.push(params);
        if (params.query.includes("restaurants in Salt Marsh")) {
          return { engine: "google_maps", query: params.query, resultCount: 0, results: [] };
        }
        if (params.query.includes("best restaurants in Brooklyn")) {
          return { engine: "google_maps", query: params.query, resultCount: 3, results: [{ title: "Place A", rating: 4.0 }] };
        }
        return { engine: "google_maps", query: params.query, resultCount: 0, results: [] };
      }),
      search: vi.fn(),
      searchHotels: vi.fn(),
    };
    await researchPlaces(
      asClient(fake),
      requirements({ destination: "Salt Marsh Nature Center, Brooklyn" }),
    );
    const foodQueries = calls.filter((c) => c.query.includes("restaurant"));
    expect(foodQueries.length).toBeGreaterThan(1);
    expect(foodQueries.some((q) => q.query.includes("Brooklyn"))).toBe(true);
  });
});

describe("rankPlacesByRelevance", () => {
  const places = [
    { title: "Low Rated Park", rating: 3.0, reviews: 10 },
    { title: "High Rated Museum", rating: 4.8, reviews: 500 },
    { title: "Medium Rated Fort", rating: 4.2, reviews: 100 },
  ] as unknown as import("../src/server/services/serpapi/types").NormalizedMapsPlace[];

  it("ranks higher-rated places first", () => {
    const ranked = rankPlacesByRelevance(places, []);
    expect(ranked[0].title).toBe("High Rated Museum");
    expect(ranked[1].title).toBe("Medium Rated Fort");
    expect(ranked[2].title).toBe("Low Rated Park");
  });

  it("boosts places matching user interests", () => {
    const historyPlaces = [
      { title: "City Park", rating: 4.0, reviews: 50, placeTypes: ["park"] },
      { title: "Old Fort", rating: 4.0, reviews: 50, placeTypes: ["fort"] },
    ] as unknown as import("../src/server/services/serpapi/types").NormalizedMapsPlace[];
    const ranked = rankPlacesByRelevance(historyPlaces, ["history"]);
    expect(ranked[0].title).toBe("Old Fort");
  });

  it("handles missing rating and reviews gracefully", () => {
    const incomplete = [
      { title: "No Data Place" },
      { title: "Rated Place", rating: 4.5, reviews: 100 },
    ] as unknown as import("../src/server/services/serpapi/types").NormalizedMapsPlace[];
    const ranked = rankPlacesByRelevance(incomplete, []);
    expect(ranked[0].title).toBe("Rated Place");
    expect(ranked[1].title).toBe("No Data Place");
  });
});
