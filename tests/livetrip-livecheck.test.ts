/**
 * Unit tests for the live situation check service and route.
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Live behavior is verified separately against real SerpApi.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { checkLiveSituation } from "../src/server/livetrip/liveCheck";
import { POST } from "../app/api/trips/active/live-check/route";
import type { ActiveTrip } from "../src/server/livetrip/activeTrip";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function trip(extra: Record<string, unknown> = {}): ActiveTrip {
  return {
    tripId: "trip_test",
    status: "ACTIVE",
    activatedFrom: "APPROVED",
    activatedAt: NOW.toISOString(),
    plan: {
      destination: "Jaipur",
      dateMode: "fixed",
      startDate: "2026-11-10",
      endDate: "2026-11-11",
      durationDays: 2,
      party: { adults: 2, children: 0 },
      budgetVerdict: "within",
      assumptions: [],
      warnings: [],
      days: [
        {
          dayNumber: 1,
          date: "2026-11-10",
          items: [
            {
              id: "d1-a1",
              kind: "attraction",
              title: "Synthetic Fort",
              startTime: "09:30",
              endTime: "12:00",
              place: { name: "Synthetic Fort" },
              evidence: [
                {
                  engine: "google_maps",
                  observedAt: NOW.toISOString(),
                  placeId: "ChX1",
                  query: "tourist attractions in Jaipur",
                  purpose: "attraction",
                  facts: { rating: 4.5, openState: "Open now" },
                },
              ],
            },
          ],
          dayCost: { lines: [], currency: "INR" },
        },
      ],
      totals: { lines: [], currency: "INR" },
      pricesVerified: true,
    },
    currentDayNumber: 1,
    progress: [
      { dayNumber: 1, items: [{ itemId: "d1-a1", status: "UPCOMING" }] },
    ],
    ...extra,
  } as ActiveTrip;
}

function fakeClient(
  mapsResults: unknown[] | Error = [],
  searchResults: unknown[] | Error = [],
) {
  return {
    searchMaps: vi.fn().mockImplementation(() => {
      if (mapsResults instanceof Error) return Promise.reject(mapsResults);
      return Promise.resolve({
        engine: "google_maps",
        query: "q",
        resultCount: (mapsResults as unknown[]).length,
        results: mapsResults,
      });
    }),
    search: vi.fn().mockImplementation(() => {
      if (searchResults instanceof Error) return Promise.reject(searchResults);
      return Promise.resolve({
        engine: "google",
        query: "q",
        resultCount: (searchResults as unknown[]).length,
        results: searchResults,
      });
    }),
    searchHotels: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const OPEN_PLACE = {
  position: 1,
  title: "Synthetic Fort",
  placeId: "ChX1",
  rating: 4.5,
  openState: "Open now",
};

describe("checkLiveSituation", () => {
  it("rejects malformed snapshots", async () => {
    const fake = fakeClient();
    await expect(checkLiveSituation({}, asClient(fake), NOW)).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects non-ACTIVE trips", async () => {
    const fake = fakeClient();
    await expect(
      checkLiveSituation(trip({ status: "COMPLETED" }), asClient(fake), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("reports CLEAR for open, matching places", async () => {
    const fake = fakeClient([OPEN_PLACE], []);
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).toBe("CLEAR");
    expect(res.checkedAt).toBe(NOW.toISOString());
    expect(res.checkedItemIds).toContain("d1-a1");
    expect(res.situations).toEqual([]);
  });

  it("reports DISRUPTION on closure signals", async () => {
    const fake = fakeClient(
      [{ ...OPEN_PLACE, openState: "Permanently closed" }],
      [],
    );
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).toBe("DISRUPTION");
    expect(res.situations).toHaveLength(1);
    expect(res.situations[0]?.type).toBe("CLOSED");
    expect(res.situations[0]?.severity).toBe("high");
    expect(res.situations[0]?.affectedItemIds).toEqual(["d1-a1"]);
    expect(res.situations[0]?.recommendedAction).toBe("replace");
  });

  it("reports ATTENTION on changed open state", async () => {
    const fake = fakeClient([{ ...OPEN_PLACE, openState: "Closed" }], []);
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).toBe("ATTENTION");
    expect(res.situations[0]?.type).toBe("TEMPORARILY_CLOSED");
  });

  it("reports UNVERIFIED when nothing matches", async () => {
    const fake = fakeClient(
      [{ position: 1, title: "Somewhere Else" }],
      [],
    );
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).toBe("UNVERIFIED");
    expect(res.situations).toEqual([]);
  });

  it("caps search findings at ATTENTION with affected items", async () => {
    const fake = fakeClient([OPEN_PLACE], [
      {
        position: 1,
        title: "Jaipur flooding disrupts travel",
        link: "https://example.invalid/news",
        snippet: "Heavy flooding reported across Jaipur, roads closed.",
      },
    ]);
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).toBe("ATTENTION");
    const weather = res.situations.find((s) => s.type === "WEATHER");
    expect(weather?.affectedItemIds).toContain("d1-a1");
    expect(weather?.confidence).toBe("low");
  });

  it("never reports DISRUPTION from search alone", async () => {
    const fake = fakeClient([], [
      {
        position: 1,
        title: "Major Jaipur strike cancels events",
        link: "https://example.invalid/x",
        snippet: "Citywide strike, massive protest, travel disruption.",
      },
    ]);
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.status).not.toBe("DISRUPTION");
  });

  it("isolates provider failures per stream", async () => {
    const fake = fakeClient(new Error("down"), []);
    const res = await checkLiveSituation(trip(), asClient(fake), NOW);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(["CLEAR", "UNVERIFIED", "ATTENTION"]).toContain(res.status);
  });

  it("leaves the submitted trip untouched, even frozen", async () => {
    const fake = fakeClient([OPEN_PLACE], []);
    const t = trip();
    const deepFreeze = (o: unknown): void => {
      if (typeof o === "object" && o !== null && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(t);
    const before = JSON.stringify(t);
    await checkLiveSituation(t, asClient(fake), NOW);
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("POST /api/trips/active/live-check", () => {
  const ORIGINAL_KEY = process.env.SERPAPI_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = ORIGINAL_KEY;
  });

  function post(body: string): Request {
    return new Request("http://localhost/api/trips/active/live-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects non-ACTIVE trips with 409", async () => {
    process.env.SERPAPI_KEY = "test-only-mock-key-not-real";
    const res = await POST(
      post(JSON.stringify({ trip: trip({ status: "COMPLETED" }) })),
    );
    expect(res.status).toBe(409);
  });

  it("rejects malformed snapshots with 400", async () => {
    const res = await POST(post(JSON.stringify({ trip: {} })));
    expect(res.status).toBe(400);
  });
});
