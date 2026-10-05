/**
 * Unit tests for the RealityCheck verification service.
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Live behavior is verified separately against real SerpApi.
 */
import { describe, expect, it, vi } from "vitest";
import { UpstreamError, ValidationError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { checkTrip } from "../src/server/realitycheck/service";
import type { Evidence, TripPlan } from "../src/server/trips/plan";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function placeEvidence(extra: Record<string, unknown> = {}): Evidence {
  return {
    engine: "google_maps",
    observedAt: "2026-10-04T00:00:00.000Z",
    placeId: "ChX1",
    query: "tourist attractions in Jaipur",
    purpose: "attraction",
    facts: {
      rating: 4.5,
      reviews: 1000,
      address: "Synthetic Road, Jaipur",
      ...extra,
    },
  };
}

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
        query: "hotels in Jaipur",
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
            id: "d1-attraction-1",
            kind: "attraction",
            title: "Synthetic Fort",
            startTime: "09:30",
            endTime: "12:00",
            place: { name: "Synthetic Fort" },
            evidence: [placeEvidence()],
          },
          {
            id: "d1-note-1",
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

function fakeClient(mapsPlace: unknown, hotel: unknown) {
  return {
    searchMaps: vi.fn().mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: 1,
      results: [mapsPlace],
    }),
    searchHotels: vi.fn().mockResolvedValue({
      engine: "google_hotels",
      query: "q",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      currency: "INR",
      resultCount: 1,
      results: [hotel],
    }),
    search: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
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

describe("realitycheck service", () => {
  it("rejects invalid plans", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    await expect(checkTrip({}, asClient(fake), NOW)).rejects.toThrow(
      ValidationError,
    );
  });

  it("re-runs the stored discovery query for verification", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    await checkTrip(plan(), asClient(fake), NOW);
    const sent = fake.searchMaps.mock.calls[0][0] as { query: string };
    expect(sent.query).toBe("tourist attractions in Jaipur");
  });

  it("marks matching items VERIFIED", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    const res = await checkTrip(plan(), asClient(fake), NOW);
    expect(res.summary.verified).toBe(2);
    expect(res.summary.problem).toBe(0);
    const attraction = res.items.find((i) => i.itemId === "d1-attraction-1");
    expect(attraction?.status).toBe("VERIFIED");
    expect(attraction?.plannedEvidence).toBeDefined();
    expect(attraction?.freshEvidence?.observedAt).toBe(NOW.toISOString());
    const stay = res.items.find((i) => i.itemId === "stay");
    expect(stay?.status).toBe("VERIFIED");
  });

  it("flags non-budget price drift as NEEDS_ATTENTION", async () => {
    const fake = fakeClient(FRESH_PLACE, {
      ...FRESH_HOTEL,
      totalLowestExtracted: 11000,
    });
    const res = await checkTrip(plan(), asClient(fake), NOW);
    const stay = res.items.find((i) => i.itemId === "stay");
    expect(stay?.status).toBe("NEEDS_ATTENTION");
  });

  it("marks budget-violating drift as PROBLEM", async () => {
    const fake = fakeClient(FRESH_PLACE, {
      ...FRESH_HOTEL,
      totalLowestExtracted: 30000,
    });
    const res = await checkTrip(plan(), asClient(fake), NOW);
    const stay = res.items.find((i) => i.itemId === "stay");
    expect(stay?.status).toBe("PROBLEM");
    expect(stay?.reasons.some((r) => r.includes("budget"))).toBe(true);
  });

  it("marks permanently closed places as PROBLEM", async () => {
    const fake = fakeClient(
      { ...FRESH_PLACE, openState: "Permanently closed" },
      FRESH_HOTEL,
    );
    const res = await checkTrip(plan(), asClient(fake), NOW);
    const attraction = res.items.find((i) => i.itemId === "d1-attraction-1");
    expect(attraction?.status).toBe("PROBLEM");
  });

  it("never marks provider failures as VERIFIED", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    fake.searchMaps.mockRejectedValue(new UpstreamError("down"));
    fake.searchHotels.mockRejectedValue(new UpstreamError("down"));
    const res = await checkTrip(plan(), asClient(fake), NOW);
    expect(res.summary.verified).toBe(0);
    expect(res.summary.unverified).toBe(3);
    expect(
      res.warnings.some((w) => w.includes("All verification requests failed")),
    ).toBe(true);
  });

  it("marks notes and generic meals UNVERIFIED", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    const res = await checkTrip(plan(), asClient(fake), NOW);
    const note = res.items.find((i) => i.itemId === "d1-note-1");
    expect(note?.status).toBe("UNVERIFIED");
  });

  it("treats unmatchable places as UNVERIFIED, not PROBLEM", async () => {
    const fake = fakeClient(
      { position: 1, title: "Somewhere Else" },
      FRESH_HOTEL,
    );
    const res = await checkTrip(plan(), asClient(fake), NOW);
    const attraction = res.items.find((i) => i.itemId === "d1-attraction-1");
    expect(attraction?.status).toBe("UNVERIFIED");
    expect(res.summary.problem).toBe(0);
  });

  it("verifies duplicate places with a single request", async () => {    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    const p = plan();
    p.days[0]?.items.push({
      id: "d1-attraction-2",
      kind: "attraction",
      title: "Synthetic Fort",
      place: { name: "Synthetic Fort" },
      evidence: [placeEvidence()],
    });
    const res = await checkTrip(p, asClient(fake), NOW);
    expect(fake.searchMaps).toHaveBeenCalledTimes(1);
    expect(
      res.items.filter((i) => i.title === "Synthetic Fort").length,
    ).toBe(2);
  });

  it("batches distinct places sharing one discovery query", async () => {
    const fake = fakeClient(
      {
        position: 1,
        title: "Synthetic Fort",
        placeId: "ChX1",
        rating: 4.5,
        reviews: 1000,
      },
      FRESH_HOTEL,
    );
    fake.searchMaps.mockResolvedValue({
      engine: "google_maps",
      query: "tourist attractions in Jaipur",
      resultCount: 2,
      results: [
        {
          position: 1,
          title: "Synthetic Fort",
          placeId: "ChX1",
          rating: 4.5,
          reviews: 1000,
        },
        {
          position: 2,
          title: "Synthetic Palace",
          placeId: "ChX2",
          rating: 4.4,
          reviews: 800,
        },
      ],
    });
    const p = plan();
    p.days[0]?.items.push({
      id: "d1-attraction-2",
      kind: "attraction",
      title: "Synthetic Palace",
      place: { name: "Synthetic Palace" },
      evidence: [
        placeEvidence({ placeId: "ChX2", rating: 4.4, reviews: 800 }),
      ],
    });
    const res = await checkTrip(p, asClient(fake), NOW);
    expect(fake.searchMaps).toHaveBeenCalledTimes(1);
    expect(
      res.items.find((i) => i.itemId === "d1-attraction-2")?.status,
    ).toBe("VERIFIED");
  });

  it("caps verification budget explicitly", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    const res = await checkTrip(plan(), asClient(fake), NOW, { maxItems: 1 });
    const capped = res.items.filter((i) =>
      i.reasons.includes("Beyond the verification budget; not checked."),
    );
    expect(capped.length).toBeGreaterThan(0);
    expect(
      res.warnings.some((w) => w.includes("verification budget")),
    ).toBe(true);
  });

  it("marks flexible-date stays UNVERIFIED", async () => {
    const fake = fakeClient(FRESH_PLACE, FRESH_HOTEL);
    const p = plan({
      dateMode: "flexible",
      startDate: undefined,
      endDate: undefined,
    });
    const res = await checkTrip(p, asClient(fake), NOW);
    const stay = res.items.find((i) => i.itemId === "stay");
    expect(stay?.status).toBe("UNVERIFIED");
    expect(fake.searchHotels).not.toHaveBeenCalled();
  });
});
