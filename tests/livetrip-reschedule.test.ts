/**
 * Unit tests for bounded live reschedule proposals (Phase 7 Prompt 2).
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Live behavior is verified separately against real SerpApi.
 */
import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import {
  discoveryQueryFor,
  isActionableSituation,
  proposeReschedule,
} from "../src/server/livetrip/reschedule";
import type { ActiveTrip } from "../src/server/livetrip/activeTrip";
import type { LiveSituationResult } from "../src/server/livetrip/situation";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function trip(): ActiveTrip {
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
              title: "Old Fort",
              startTime: "09:30",
              endTime: "12:00",
              place: { name: "Old Fort" },
              evidence: [
                {
                  engine: "google_maps",
                  observedAt: NOW.toISOString(),
                  placeId: "old",
                  query: "tourist attractions in Jaipur",
                  purpose: "attraction",
                  facts: { rating: 4.5 },
                },
              ],
            },
            {
              id: "d1-a2",
              kind: "attraction",
              title: "Old Museum",
              startTime: "14:00",
              endTime: "16:30",
              place: { name: "Old Museum" },
              evidence: [
                {
                  engine: "google_maps",
                  observedAt: NOW.toISOString(),
                  placeId: "museum",
                  query: "tourist attractions in Jaipur",
                  purpose: "attraction",
                  facts: { rating: 4.4 },
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
      {
        dayNumber: 1,
        items: [
          { itemId: "d1-a1", status: "UPCOMING" },
          { itemId: "d1-a2", status: "UPCOMING" },
        ],
      },
    ],
  } as ActiveTrip;
}

function closedSituation(itemId: string, title: string) {
  return {
    situationId: `closed-${itemId}`,
    type: "CLOSED",
    title: `${title} is reported closed`,
    description: "Live Maps data reports permanent closure.",
    severity: "high",
    confidence: "high",
    evidence: {
      engine: "google_maps",
      query: "tourist attractions in Jaipur",
      observedAt: NOW.toISOString(),
      facts: { openState: "Permanently closed" },
    },
    affectedItemIds: [itemId],
    recommendedAction: "replace",
  };
}

function liveCheck(
  situations: unknown[] = [],
  status: LiveSituationResult["status"] = "DISRUPTION",
): LiveSituationResult {
  return {
    checkedAt: NOW.toISOString(),
    destination: "Jaipur",
    status,
    situations: situations as LiveSituationResult["situations"],
    checkedItemIds: ["d1-a1"],
    affectedItemIds: ["d1-a1"],
    queriesUsed: ["tourist attractions in Jaipur"],
    warnings: [],
  };
}

function fakeClient(mapsImpl: (query: string) => unknown) {
  return {
    searchMaps: vi.fn().mockImplementation((args: { query: string }) => {
      const payload = mapsImpl(args.query);
      if (payload instanceof Error) return Promise.reject(payload);
      return Promise.resolve({
        engine: "google_maps",
        query: args.query,
        resultCount: (payload as unknown[]).length,
        results: payload,
      });
    }),
    search: vi.fn(),
    searchHotels: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const GOOD_POOL = [
  { position: 1, title: "New Palace", placeId: "new1", rating: 4.8, reviews: 2000 },
  { position: 2, title: "New Garden", placeId: "new2", rating: 4.4, reviews: 900 },
];

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

describe("actionability", () => {
  it("treats CLOSED as actionable", () => {
    expect(isActionableSituation({ type: "CLOSED" } as never)).toBe(true);
  });

  it("treats TEMPORARILY_CLOSED and SCHEDULE_CHANGE as actionable", () => {
    expect(isActionableSituation({ type: "TEMPORARILY_CLOSED" } as never)).toBe(true);
    expect(isActionableSituation({ type: "SCHEDULE_CHANGE" } as never)).toBe(true);
  });

  it("excludes WEATHER, EVENT, GENERAL, and UNKNOWN", () => {
    for (const type of ["WEATHER", "EVENT_DISRUPTION", "GENERAL_TRAVEL_DISRUPTION", "UNKNOWN"]) {
      expect(isActionableSituation({ type } as never)).toBe(false);
    }
  });
});

describe("discoveryQueryFor", () => {
  it("uses restaurants for meals", () => {
    expect(discoveryQueryFor("meal", "Lunch near X", "Jaipur")).toBe(
      "restaurants in Jaipur",
    );
  });

  it("uses category templates for museums", () => {
    expect(discoveryQueryFor("attraction", "City Museum", "Jaipur")).toBe(
      "museums in Jaipur",
    );
  });

  it("falls back to general attractions", () => {
    expect(discoveryQueryFor("attraction", "Amber Palace", "Jaipur")).toBe(
      "tourist attractions in Jaipur",
    );
  });
});

describe("proposeReschedule", () => {
  it("rejects non-ACTIVE trips", async () => {
    const fake = fakeClient(() => []);
    await expect(
      proposeReschedule(
        { trip: { ...trip(), status: "COMPLETED" }, liveCheck: liveCheck() },
        asClient(fake),
        NOW,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects destination-mismatched live checks", async () => {
    const fake = fakeClient(() => []);
    const check = { ...liveCheck(), destination: "Paris" };
    await expect(
      proposeReschedule({ trip: trip(), liveCheck: check }, asClient(fake), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("returns an empty proposal when nothing is actionable", async () => {
    const fake = fakeClient(() => []);
    const res = await proposeReschedule(
      { trip: trip(), liveCheck: liveCheck([], "CLEAR") },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("proposes a verified replacement preserving the slot", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await proposeReschedule(
      {
        trip: trip(),
        liveCheck: liveCheck([closedSituation("d1-a1", "Old Fort")]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toHaveLength(1);
    const change = res.changes[0]!;
    expect(change.itemId).toBe("d1-a1");
    expect(change.dayNumber).toBe(1);
    expect(change.action).toBe("REPLACE_ITEM");
    expect(change.replacement.startTime).toBe("09:30");
    expect(change.replacement.endTime).toBe("12:00");
    expect(change.replacement.kind).toBe("attraction");
    expect(change.replacement.title).toBe("New Palace");
    expect(change.recheck.status).toBe("VERIFIED");
    const firstEvidence = change.replacement.evidence[0] as
      | { observedAt?: string }
      | undefined;
    expect(firstEvidence?.observedAt).toBe(NOW.toISOString());
    expect(res.basedOnCheckedAt).toBe(NOW.toISOString());
  });

  it("marks issues unfixable when every candidate fails recheck", async () => {
    const fake = fakeClient(() => [
      { ...GOOD_POOL[0], openState: "Permanently closed" },
    ]);
    const res = await proposeReschedule(
      {
        trip: trip(),
        liveCheck: liveCheck([closedSituation("d1-a1", "Old Fort")]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toHaveLength(1);
    expect(res.unfixable[0]?.reason).toContain("re-verification");
  });

  it("marks research failures unfixable without fabrication", async () => {
    const fake = fakeClient(() => {
      throw new Error("down");
    });
    const res = await proposeReschedule(
      {
        trip: trip(),
        liveCheck: liveCheck([closedSituation("d1-a1", "Old Fort")]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toHaveLength(1);
  });

  it("never selects the failed or scheduled place", async () => {
    const fake = fakeClient(() => [
      { position: 1, title: "Old Fort", placeId: "old", rating: 4.9 },
      { position: 2, title: "Old Museum", placeId: "museum", rating: 4.9 },
      ...GOOD_POOL,
    ]);
    const res = await proposeReschedule(
      {
        trip: trip(),
        liveCheck: liveCheck([closedSituation("d1-a1", "Old Fort")]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes[0]?.replacement.title).toBe("New Palace");
  });

  it("gives competing issues distinct replacements", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const both = liveCheck([
      closedSituation("d1-a1", "Old Fort"),
      closedSituation("d1-a2", "Old Museum"),
    ]);
    const res = await proposeReschedule(
      { trip: trip(), liveCheck: both },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toHaveLength(2);
    const titles = res.changes.map((c) => c.replacement.title).sort();
    expect(titles).toEqual(["New Garden", "New Palace"]);
  });

  it("marks unknown affected items unfixable without failing others", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const both = liveCheck([
      closedSituation("d1-a1", "Old Fort"),
      closedSituation("ghost", "Ghost Place"),
    ]);
    const res = await proposeReschedule(
      { trip: trip(), liveCheck: both },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toHaveLength(1);
    expect(res.unfixable.some((u) => u.itemId === "ghost")).toBe(true);
  });

  it("leaves inputs untouched, even frozen", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const t = trip();
    const c = liveCheck([closedSituation("d1-a1", "Old Fort")]);
    deepFreeze(t);
    deepFreeze(c);
    const beforeTrip = JSON.stringify(t);
    const beforeCheck = JSON.stringify(c);
    await proposeReschedule({ trip: t, liveCheck: c }, asClient(fake), NOW);
    expect(JSON.stringify(t)).toBe(beforeTrip);
    expect(JSON.stringify(c)).toBe(beforeCheck);
  });

  it("marks stay-kind items unfixable in this step", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await proposeReschedule(
      {
        trip: trip(),
        liveCheck: liveCheck([
          { ...closedSituation("stay", "Old Inn") },
        ]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });
});
