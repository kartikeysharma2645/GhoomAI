/**
 * Phase 9 Prompt 3 service tests: final pre-trip recheck orchestration.
 * The SerpApiClient is replaced with explicitly labeled fakes returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Live behavior is verified separately against real SerpApi.
 */
import { describe, expect, it, vi } from "vitest";
import { ConflictError, UpstreamError, ValidationError } from "../src/lib/errors";
import {
  optionFromHotel,
  optionFromMapsPlace,
  optionFromOrganic,
} from "../src/server/booking/discovery";
import { MAX_RECHECK_OPTIONS, runFinalRecheck } from "../src/server/booking/recheck";
import type { BookingOption } from "../src/server/booking/types";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import type { TripPlan } from "../src/server/trips/plan";

const NOW = new Date("2026-10-06T00:00:00.000Z");

function plan(extra: Record<string, unknown> = {}): TripPlan {
  return {
    destination: "Jaipur",
    dateMode: "fixed",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    durationDays: 3,
    party: { adults: 2, children: 0 },
    budget: { amount: 25000, currency: "INR" },
    budgetVerdict: "within",
    assumptions: [],
    warnings: [],
    stay: {
      hotelName: "Synthetic Grand",
      nights: 2,
      total: { label: "Stay", amount: 10000, currency: "INR", basis: "live" },
      evidence: {
        engine: "google_hotels",
        observedAt: "2026-10-04T00:00:00.000Z",
        propertyToken: "tok1",
        query: "Synthetic Grand",
        purpose: "stay_selection",
        currency: "INR",
        facts: { rating: 4.6, reviews: 500, totalExtracted: 10000 },
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
                facts: { rating: 4.5, reviews: 1000, address: "Synthetic Road, Jaipur" },
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
    totals: {
      lines: [],
      liveTotal: { label: "Stay", amount: 10000, currency: "INR", basis: "live" },
      currency: "INR",
    },
    pricesVerified: true,
    ...extra,
  } as TripPlan;
}

const FRESH_PLACE = {
  position: 1,
  title: "Synthetic Fort",
  placeId: "ChX1",
  rating: 4.5,
  reviews: 1000,
  address: "Synthetic Road, Jaipur",
};

const FRESH_HOTEL = {
  position: 1,
  name: "Synthetic Grand",
  propertyToken: "tok1",
  overallRating: 4.6,
  reviews: 500,
  totalLowestExtracted: 10000,
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

function mapsOption(): BookingOption {
  return optionFromMapsPlace({
    itemId: "d1-a1",
    place: { ...FRESH_PLACE, links: { website: "https://fort.example.com/info" } },
    sentQuery: "Synthetic Fort Jaipur",
    purpose: "attraction",
    observedAt: "2026-10-05T00:00:00.000Z",
    leadType: "CORROBORATED",
  });
}

function hotelOption(): BookingOption {
  return optionFromHotel({
    itemId: "stay",
    hotel: FRESH_HOTEL,
    sentQuery: "Synthetic Grand",
    currency: "INR",
    observedAt: "2026-10-05T00:00:00.000Z",
    leadType: "CORROBORATED",
  });
}

function webOption(): BookingOption {
  const option = optionFromOrganic({
    itemId: "d1-a1",
    result: {
      position: 1,
      title: "Synthetic Fort tickets and timings",
      link: "https://tickets.example.com/fort",
      snippet: "Compare Synthetic Fort ticket options.",
    },
    sentQuery: "Synthetic Fort Jaipur tickets",
    purpose: "attraction",
    observedAt: "2026-10-05T00:00:00.000Z",
    leadType: "SEARCH_LEAD",
  });
  if (!option) throw new Error("synthetic web option must build");
  return option;
}

describe("runFinalRecheck", () => {
  it("rejects invalid plans and non-approved states", async () => {
    const fake = fakeClient({});
    await expect(
      runFinalRecheck({ plan: {} as TripPlan, status: "APPROVED" }, asClient(fake), NOW),
    ).rejects.toThrow(ValidationError);
    await expect(
      runFinalRecheck({ plan: plan(), status: "VERIFIED" }, asClient(fake), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("returns CLEAR with fresh timestamps and never mutates the plan", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], hotels: [FRESH_HOTEL] });
    const input = plan();
    const before = JSON.stringify(input);
    const res = await runFinalRecheck(
      { plan: input, status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(res.verdict).toBe("CLEAR");
    expect(res.checkedAt).toBe(NOW.toISOString());
    expect(res.summary.verified).toBe(2);
    expect(res.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
    expect(res.booking).toEqual({ performed: false, bookingId: null, confirmationCode: null });
  });

  it("reports NEEDS_ATTENTION on price drift without blocking", async () => {
    const fake = fakeClient({
      maps: [FRESH_PLACE],
      hotels: [{ ...FRESH_HOTEL, totalLowestExtracted: 11000 }],
    });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [hotelOption()] },
      asClient(fake),
      NOW,
    );
    expect(res.verdict).toBe("NEEDS_ATTENTION");
    const option = res.options.find((o) => o.itemId === "stay");
    expect(option?.status).toBe("SUPPORTED_WITH_CHANGES");
  });

  it("reports PROBLEM on closure and marks the option no longer supported", async () => {
    const fake = fakeClient({
      maps: [{ ...FRESH_PLACE, openState: "Permanently closed" }],
      hotels: [FRESH_HOTEL],
    });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [mapsOption()] },
      asClient(fake),
      NOW,
    );
    expect(res.verdict).toBe("PROBLEM");
    expect(res.summary.problem).toBe(1);
    expect(
      res.options.find((o) => o.itemId === "d1-a1")?.status,
    ).toBe("NO_LONGER_SUPPORTED");
  });

  it("supports a stable-ID option against fresh verification", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], hotels: [FRESH_HOTEL] });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [mapsOption(), hotelOption()] },
      asClient(fake),
      NOW,
    );
    expect(res.verdict).toBe("CLEAR");
    expect(res.options.map((o) => o.status)).toEqual(["SUPPORTED", "SUPPORTED"]);
    for (const o of res.options) {
      expect(o.handoffType).toBe("EXTERNAL");
      expect(o.observedAt).toBe(NOW.toISOString());
    }
    // Stable-ID corroboration costs no extra web searches.
    expect(fake.search).not.toHaveBeenCalled();
  });

  it("returns UNVERIFIED — never CLEAR — when no evidence is available", async () => {
    const fake = fakeClient({
      mapsError: new UpstreamError("down"),
      hotelsError: new UpstreamError("down"),
    });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    expect(res.verdict).toBe("UNVERIFIED");
    expect(res.summary.verified).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("keeps partial results alive without upgrading UNVERIFIED items", async () => {
    const fake = fakeClient({
      mapsError: new UpstreamError("maps down"),
      hotels: [FRESH_HOTEL],
    });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED" },
      asClient(fake),
      NOW,
    );
    // Informational/failed items stay UNVERIFIED; verified items carry CLEAR.
    expect(res.summary.verified).toBe(1);
    expect(res.verdict).toBe("CLEAR");
    expect(
      res.findings.find((f) => f.itemId === "d1-a1")?.status,
    ).toBe("UNVERIFIED");
  });

  it("reconfirms an organic option only when its page reappears", async () => {
    const present = fakeClient({
      maps: [],
      hotels: [],
      web: [
        {
          position: 1,
          title: "Synthetic Fort tickets and timings",
          link: "https://tickets.example.com/fort",
          snippet: "Compare Synthetic Fort ticket options.",
        },
      ],
    });
    const supported = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [webOption()] },
      asClient(present),
      NOW,
    );
    expect(supported.options[0]?.status).toBe("SUPPORTED");

    const absent = fakeClient({
      maps: [],
      hotels: [],
      web: [
        {
          position: 1,
          title: "Unrelated cooking recipes",
          link: "https://recipes.example.com/x",
          snippet: "Pasta recipes for dinner.",
        },
      ],
    });
    const gone = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [webOption()] },
      asClient(absent),
      NOW,
    );
    expect(gone.options[0]?.status).toBe("NO_LONGER_SUPPORTED");
    expect(gone.verdict).toBe("PROBLEM");
  });

  it("leaves the option UNVERIFIED when the corroborating search fails", async () => {
    const fake = fakeClient({
      maps: [],
      hotels: [],
      webError: new UpstreamError("web down"),
    });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [webOption()] },
      asClient(fake),
      NOW,
    );
    expect(res.options[0]?.status).toBe("UNVERIFIED");
    expect(res.warnings.some((w) => w.includes("re-search failed"))).toBe(true);
  });

  it("marks tampered or swapped-URL options STALE without failing the recheck", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], hotels: [FRESH_HOTEL] });
    const forged = { ...mapsOption(), optionId: "d1-a1:google_maps:forged" };
    const swapped = { ...mapsOption(), url: "https://evil.example/phish" };
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [forged, swapped] },
      asClient(fake),
      NOW,
    );
    expect(res.options.map((o) => o.status)).toEqual(["STALE", "STALE"]);
    expect(res.verdict).toBe("NEEDS_ATTENTION");
  });

  it("caps reselected options explicitly", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], hotels: [FRESH_HOTEL] });
    const many = Array.from({ length: MAX_RECHECK_OPTIONS + 1 }, () => mapsOption());
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: many },
      asClient(fake),
      NOW,
    );
    expect(res.options.length).toBe(MAX_RECHECK_OPTIONS);
    expect(res.warnings.some((w) => w.includes("first 10"))).toBe(true);
  });

  it("never claims booking, activation, prices, or availability", async () => {
    const fake = fakeClient({ maps: [FRESH_PLACE], hotels: [FRESH_HOTEL] });
    const res = await runFinalRecheck(
      { plan: plan(), status: "APPROVED", selections: [mapsOption()] },
      asClient(fake),
      NOW,
    );
    const serialized = JSON.stringify(res).toLowerCase();
    expect(serialized).not.toContain("booking confirmed");
    expect(serialized).not.toContain("confirmed booking");
    expect(serialized).not.toContain("booking completed");
    expect(serialized).not.toContain("availability");
    expect(serialized).not.toMatch(/"amount"/);
    expect(serialized).not.toContain("tripid");
    expect(serialized).not.toContain("activetrip");
    expect(serialized).not.toMatch(/"status":"active"/);
  });
});
