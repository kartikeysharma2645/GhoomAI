/**
 * Phase 9 Prompt 2 service tests: live booking-option discovery.
 * The SerpApiClient is replaced with explicitly labeled fakes returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Live behavior is verified separately against real SerpApi.
 */
import { describe, expect, it, vi } from "vitest";
import { ConflictError, UpstreamError, ValidationError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import type { TripPlan } from "../src/server/trips/plan";
import {
  buildDiscoverySearches,
  discoverBookingOptions,
  isRelevantResult,
  MAX_DISCOVERY_ITEMS,
  safeExternalUrl,
} from "../src/server/booking/discovery";

const NOW = new Date("2026-10-06T00:00:00.000Z");

function plan(extra: Record<string, unknown> = {}): TripPlan {
  return {
    destination: "Jaipur",
    dateMode: "fixed",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    durationDays: 3,
    party: { adults: 2, children: 0 },
    budgetVerdict: "within",
    assumptions: [],
    warnings: [],
    stay: {
      hotelName: "Synthetic Grand",
      nights: 2,
      evidence: {
        engine: "google_hotels",
        observedAt: "2026-10-04T00:00:00.000Z",
        propertyToken: "tok1",
        query: "Synthetic Grand",
        purpose: "stay_selection",
        currency: "INR",
        facts: {},
      },
    },
    days: [
      {
        dayNumber: 1,
        date: "2026-11-10",
        items: [
          {
            id: "d1-a1",
            kind: "attraction",
            title: "Synthetic Fort",
            place: { name: "Synthetic Fort" },
            evidence: [
              {
                engine: "google_maps",
                observedAt: "2026-10-04T00:00:00.000Z",
                placeId: "ChX1",
                query: "tourist attractions in Jaipur",
                purpose: "attraction",
                facts: {},
              },
            ],
          },
          {
            id: "d1-n1",
            kind: "note",
            title: "Evening at leisure",
            evidence: [],
          },
        ],
        dayCost: { lines: [], currency: "INR" },
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
    ...extra,
  } as TripPlan;
}

const FRESH_PLACE = {
  position: 1,
  title: "Synthetic Fort",
  placeId: "ChX1",
  address: "Synthetic Road, Jaipur",
  links: { website: "https://fort.example.com/info" },
};

const FRESH_HOTEL = {
  position: 1,
  name: "Synthetic Grand",
  propertyToken: "tok1",
  overallRating: 4.6,
};

const ORGANIC_OFFICIAL = {
  position: 1,
  title: "Synthetic Fort",
  link: "https://fort.example.com",
  snippet: "Official visitor information for Synthetic Fort.",
};

const ORGANIC_TICKETS = {
  position: 2,
  title: "Synthetic Fort tickets and timings",
  link: "https://tickets.example.com/fort",
  snippet: "Compare Synthetic Fort ticket options.",
};

const ORGANIC_UNRELATED = {
  position: 3,
  title: "Unrelated cooking recipes",
  link: "https://recipes.example.com/x",
  snippet: "Pasta recipes for dinner.",
};

function fakeClient(overrides: {
  maps?: unknown[];
  hotels?: unknown[];
  web?: unknown[];
  mapsError?: Error;
  hotelsError?: Error;
  webError?: Error;
}) {
  return {
    searchMaps: vi.fn().mockImplementation(() => {
      if (overrides.mapsError) return Promise.reject(overrides.mapsError);
      return Promise.resolve({
        engine: "google_maps",
        query: "q",
        resultCount: (overrides.maps ?? []).length,
        results: overrides.maps ?? [],
      });
    }),
    searchHotels: vi.fn().mockImplementation(() => {
      if (overrides.hotelsError) return Promise.reject(overrides.hotelsError);
      return Promise.resolve({
        engine: "google_hotels",
        query: "q",
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        currency: "INR",
        resultCount: (overrides.hotels ?? []).length,
        results: overrides.hotels ?? [],
      });
    }),
    search: vi.fn().mockImplementation(() => {
      if (overrides.webError) return Promise.reject(overrides.webError);
      return Promise.resolve({
        engine: "google",
        query: "q",
        resultCount: (overrides.web ?? []).length,
        results: overrides.web ?? [],
      });
    }),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

describe("buildDiscoverySearches", () => {
  const base = {
    destination: "Jaipur",
    dateMode: "fixed" as const,
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    party: { adults: 2, children: 0 },
    totals: { lines: [], currency: "INR" },
  };
  it("builds hotel + web searches for a fixed-date stay", () => {
    const searches = buildDiscoverySearches({ kind: "stay", title: "Synthetic Grand" }, base);
    expect(searches.hotels?.query).toBe("Synthetic Grand");
    expect(searches.hotels?.checkIn).toBe("2026-11-10");
    expect(searches.web?.query).toContain("Synthetic Grand");
  });

  it("skips hotel search for flexible dates", () => {
    const searches = buildDiscoverySearches(
      { kind: "stay", title: "Synthetic Grand" },
      { ...base, dateMode: "flexible", startDate: undefined, endDate: undefined },
    );
    expect(searches.hotels).toBeUndefined();
    expect(searches.web).toBeDefined();
  });

  it("prefers maps for attractions and meals", () => {
    const attraction = buildDiscoverySearches({ kind: "attraction", title: "Synthetic Fort" }, base);
    expect(attraction.maps?.location).toBe("Jaipur");
    expect(attraction.maps?.query).toContain("Synthetic Fort");
    const meal = buildDiscoverySearches({ kind: "meal", title: "Spice House" }, base);
    expect(meal.maps).toBeDefined();
    expect(meal.web?.query).toContain("reservations");
  });
});

describe("safeExternalUrl and relevance", () => {
  it("accepts absolute http(s) and rejects the rest", () => {
    expect(safeExternalUrl("https://tickets.example.com/fort")).toContain("https://");
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("/relative/path")).toBeUndefined();
    expect(safeExternalUrl(42)).toBeUndefined();
  });

  it("filters unrelated organic results", () => {
    expect(isRelevantResult("Synthetic Fort", "Synthetic Fort tickets", "Compare options")).toBe(true);
    expect(isRelevantResult("Synthetic Fort", "Unrelated cooking recipes", "Pasta recipes")).toBe(false);
  });
});

describe("discoverBookingOptions", () => {
  it("rejects invalid plans and non-approved states", async () => {
    const fake = fakeClient({});
    await expect(
      discoverBookingOptions({ plan: {} as TripPlan, status: "APPROVED" }, asClient(fake), NOW),
    ).rejects.toThrow(ValidationError);
    await expect(
      discoverBookingOptions({ plan: plan(), status: "PLANNED" }, asClient(fake), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("discovers corroborated maps and web options with evidence", async () => {
    const fake = fakeClient({
      maps: [FRESH_PLACE],
      hotels: [FRESH_HOTEL],
      web: [ORGANIC_OFFICIAL, ORGANIC_TICKETS, ORGANIC_UNRELATED],
    });
    const res = await discoverBookingOptions(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    const attraction = res.items.find((i) => i.itemId === "d1-a1");
    expect(attraction?.status).toBe("READY");
    // Unrelated organic result is filtered out.
    expect(
      attraction?.options.some((o) => o.provider.includes("recipes.example.com")),
    ).toBe(false);
    const mapsOption = attraction?.options.find((o) => o.evidence.engine === "google_maps");
    expect(mapsOption?.leadType).toBe("CORROBORATED");
    expect(mapsOption?.url).toBe("https://fort.example.com/info");
    expect(mapsOption?.handoffType).toBe("EXTERNAL");
    expect(mapsOption?.observedAt).toBe(NOW.toISOString());
    // Exact-title organic match against the anchored place is corroborated.
    const official = attraction?.options.find((o) => o.provider === "fort.example.com");
    expect(official?.leadType).toBe("CORROBORATED");
    const stay = res.items.find((i) => i.itemId === "stay");
    expect(stay?.status).toBe("READY");
    expect(res.booking).toEqual({ performed: false, bookingId: null, confirmationCode: null });
  });

  it("returns options without urls as search leads", async () => {
    const fake = fakeClient({
      maps: [{ position: 1, title: "Synthetic Fort", placeId: "ChX1" }],
      hotels: [],
      web: [],
    });
    const res = await discoverBookingOptions(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    const mapsOption = res.items
      .find((i) => i.itemId === "d1-a1")
      ?.options.find((o) => o.evidence.engine === "google_maps");
    expect(mapsOption).toBeDefined();
    expect(mapsOption?.url).toBeUndefined();
  });

  it("marks empty searches NO_RESULTS without failing", async () => {
    const fake = fakeClient({ maps: [], hotels: [], web: [] });
    const res = await discoverBookingOptions(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(res.items.every((i) => i.status === "NO_RESULTS")).toBe(true);
    expect(res.warnings).toEqual([]);
  });

  it("isolates partial failures per item", async () => {
    const fake = fakeClient({
      hotels: [FRESH_HOTEL],
      web: [ORGANIC_OFFICIAL],
      mapsError: new UpstreamError("maps down"),
    });
    const res = await discoverBookingOptions(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(res.items.find((i) => i.itemId === "stay")?.status).toBe("READY");
    const failed = res.items.find((i) => i.itemId === "d1-a1");
    expect(failed?.status).toBe("SEARCH_FAILED");
    expect(failed?.reason).toBe("maps down");
    expect(res.warnings.some((w) => w.includes("partially"))).toBe(true);
  });

  it("throws the gateway error when every search fails", async () => {
    const fake = fakeClient({
      mapsError: new UpstreamError("all down"),
      hotelsError: new UpstreamError("all down"),
      webError: new UpstreamError("all down"),
    });
    await expect(
      discoverBookingOptions({ plan: plan(), status: "APPROVED" }, asClient(fake), NOW),
    ).rejects.toThrow(UpstreamError);
  });

  it("dedupes identical items into one search", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], web: [] });
    const p = plan();
    p.days[0]?.items.push({
      id: "d1-a2",
      kind: "attraction",
      title: "Synthetic Fort",
      place: { name: "Synthetic Fort" },
      evidence: p.days[0]?.items[0]?.evidence ?? [],
    });
    const res = await discoverBookingOptions(
      { plan: p, status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(fake.searchMaps).toHaveBeenCalledTimes(1);
    expect(res.items.find((i) => i.itemId === "d1-a2")?.status).toBe("READY");
  });

  it("caps the number of searched items explicitly", async () => {
    const fake = fakeClient({ maps: [], web: [] });
    const items = Array.from({ length: MAX_DISCOVERY_ITEMS + 1 }, (_, i) => ({
      id: `d1-a${i}`,
      kind: "attraction" as const,
      title: `Synthetic Place ${i}`,
      place: { name: `Synthetic Place ${i}` },
      evidence: [],
    }));
    const p = plan({ stay: undefined, days: [{ dayNumber: 1, items, dayCost: { lines: [], currency: "INR" } }] });
    const res = await discoverBookingOptions(
      { plan: p, status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(fake.searchMaps).toHaveBeenCalledTimes(MAX_DISCOVERY_ITEMS);
    expect(res.warnings.some((w) => w.includes("discovery cap"))).toBe(true);
  });

  it("never invents prices, availability, or confirmations", async () => {
    const fake = fakeClient({
      maps: [FRESH_PLACE],
      hotels: [FRESH_HOTEL],
      web: [ORGANIC_OFFICIAL],
    });
    const res = await discoverBookingOptions(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    const serialized = JSON.stringify(res).toLowerCase();
    // "nothing is confirmed" is the honest disclaimer; what must never
    // appear is a confirmation claim: confirmed/completed bookings.
    expect(serialized).not.toContain("booking confirmed");
    expect(serialized).not.toContain("confirmed booking");
    expect(serialized).not.toContain("availability");
    expect(serialized).not.toMatch(/"amount"/);
    expect(res.booking).toEqual({ performed: false, bookingId: null, confirmationCode: null });
    // URLs are legitimate only as absolute http(s) evidence links.
    for (const item of res.items) {
      for (const option of item.options) {
        if (option.url !== undefined) {
          expect(option.url).toMatch(/^https?:\/\//);
        }
        expect(option.handoffType).toBe("EXTERNAL");
      }
    }
  });
});
