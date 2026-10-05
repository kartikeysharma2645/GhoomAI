/**
 * Unit tests for the RealityCheck fixer (Phase 5 Step 3).
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * minimal SYNTHETIC normalized shapes — no real travel data is fabricated.
 * Re-verification runs through the real verification path (verifyTargets).
 */
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { fixTrip, isActionable } from "../src/server/realitycheck/fixer";
import type { TripPlan } from "../src/server/trips/plan";
import type { RealityCheckResult } from "../src/server/realitycheck/checks";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function placeEvidence(placeId: string, extra: Record<string, unknown> = {}) {
  return {
    engine: "google_maps",
    observedAt: "2026-10-04T00:00:00.000Z",
    placeId,
    query: "tourist attractions in Jaipur",
    purpose: "attraction",
    facts: { rating: 4.5, reviews: 1000, ...extra },
  };
}

function attractionItem(id: string, title: string, placeId: string) {
  return {
    id,
    kind: "attraction",
    title,
    startTime: "09:30",
    endTime: "12:00",
    place: { name: title },
    evidence: [placeEvidence(placeId)],
  };
}

function plan(): TripPlan {
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
    days: [
      {
        dayNumber: 1,
        date: "2026-11-10",
        items: [attractionItem("d1-a1", "Old Fort", "old")],
        dayCost: { lines: [], currency: "INR" },
      },
      {
        dayNumber: 2,
        date: "2026-11-11",
        items: [attractionItem("d2-a1", "Old Museum", "museum")],
        dayCost: { lines: [], currency: "INR" },
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  } as TripPlan;
}

function problemCheck(itemId: string, title: string, kind = "attraction") {
  return {
    itemId,
    kind,
    title,
    status: "PROBLEM",
    plannedEvidence: placeEvidence("old"),
    facts: [
      {
        fact: "openState",
        supported: true,
        outcome: "conflicting",
        detail: "Provider reports this place as permanently closed.",
      },
    ],
    reasons: ["Provider reports this place as permanently closed."],
  };
}

function check(items: unknown[]): RealityCheckResult {
  return {
    checkedAt: NOW.toISOString(),
    summary: { verified: 0, needsAttention: 0, problem: 0, unverified: 0 },
    items: items as RealityCheckResult["items"],
    warnings: [],
  };
}

function fakeClient(
  mapsImpl: (query: string) => unknown,
  hotelsImpl?: () => unknown,
) {
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
    searchHotels: vi.fn().mockImplementation(() => {
      const payload = hotelsImpl ? hotelsImpl() : [];
      if (payload instanceof Error) return Promise.reject(payload);
      return Promise.resolve({
        engine: "google_hotels",
        query: "q",
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        currency: "INR",
        resultCount: (payload as unknown[]).length,
        results: payload,
      });
    }),
    search: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

const GOOD_POOL = [
  { position: 1, title: "New Palace", placeId: "new1", rating: 4.8, reviews: 2000 },
  { position: 2, title: "New Garden", placeId: "new2", rating: 4.4, reviews: 900 },
];

describe("fixer actionability", () => {
  it("returns a zero-change proposal when nothing is actionable", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await fixTrip(
      {
        plan: plan(),
        check: check([
          {
            itemId: "d1-a1",
            kind: "attraction",
            title: "Old Fort",
            status: "VERIFIED",
            facts: [],
            reasons: [],
          },
        ]),
      },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toEqual([]);
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("treats PROBLEM as actionable", () => {
    expect(
      isActionable({ status: "PROBLEM", facts: [] }),
    ).toBe(true);
  });

  it("never treats UNVERIFIED as actionable", () => {
    expect(
      isActionable({ status: "UNVERIFIED", facts: [] }),
    ).toBe(false);
    expect(
      isActionable({
        status: "UNVERIFIED",
        facts: [{ fact: "discoverability", supported: true, outcome: "missing" }],
      }),
    ).toBe(false);
  });

  it("skips non-actionable NEEDS_ATTENTION (rating drift only)", () => {
    expect(
      isActionable({
        status: "NEEDS_ATTENTION",
        facts: [{ fact: "rating", supported: true, outcome: "changed" }],
      }),
    ).toBe(false);
    expect(
      isActionable({
        status: "NEEDS_ATTENTION",
        facts: [{ fact: "hotelPrice", supported: true, outcome: "changed" }],
      }),
    ).toBe(true);
  });
});

describe("fixer discovery and ranking", () => {
  it("discovers live candidates through the gateway", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(fake.searchMaps).toHaveBeenCalled();
    const sent = fake.searchMaps.mock.calls[0][0] as { query: string };
    expect(sent.query).toBe("tourist attractions in Jaipur");
    expect(res.changes).toHaveLength(1);
  });

  it("excludes the failed item from candidates", async () => {
    const fake = fakeClient(() => [
      { position: 1, title: "Old Fort", placeId: "old", rating: 4.9 },
      ...GOOD_POOL,
    ]);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes[0]?.replacement.title).not.toBe("Old Fort");
  });

  it("excludes already scheduled items", async () => {
    const fake = fakeClient(() => [
      { position: 1, title: "Old Museum", placeId: "museum", rating: 4.9 },
      ...GOOD_POOL,
    ]);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes[0]?.replacement.title).not.toBe("Old Museum");
  });

  it("ranks deterministically by score", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes[0]?.replacement.title).toBe("New Palace");
  });
});

describe("fixer verification loop", () => {
  it("stops after the first passing candidate", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    // 1 research + 1 confirmatory recheck.
    expect(fake.searchMaps).toHaveBeenCalledTimes(2);
  });

  it("tries the next candidate when the first fails recheck", async () => {
    let calls = 0;
    const fake = fakeClient(() => {
      calls += 1;
      if (calls === 1) return GOOD_POOL;
      if (calls === 2) {
        return [
          { ...GOOD_POOL[0], openState: "Permanently closed" },
          GOOD_POOL[1],
        ];
      }
      return GOOD_POOL;
    });
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]?.replacement.title).toBe("New Garden");
    expect(fake.searchMaps).toHaveBeenCalledTimes(3);
  });

  it("marks issues unfixable when all candidates fail", async () => {
    const fake = fakeClient(() => [
      {
        ...GOOD_POOL[0],
        openState: "Permanently closed",
        placeId: "new1",
      },
    ]);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toHaveLength(1);
    expect(res.unfixable[0]?.reason).toContain("re-verification");
  });

  it("verifies at most 3 candidates per issue", async () => {
    const big = Array.from({ length: 5 }, (_, i) => ({
      position: i + 1,
      title: `Place ${i + 1}`,
      placeId: `p${i + 1}`,
      rating: 4.9 - i * 0.1,
    }));
    const fake = fakeClient(() => [
      ...big.map((p) => ({ ...p, openState: "Permanently closed" })),
    ]);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    // 1 research + 3 rechecks.
    expect(fake.searchMaps).toHaveBeenCalledTimes(4);
    expect(res.unfixable).toHaveLength(1);
  });

  it("processes at most 3 actionable issues", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const problems = ["d1-a1", "d2-a1", "x3", "x4"].map((id) =>
      problemCheck(id, `Title ${id}`),
    );
    const res = await fixTrip(
      { plan: plan(), check: check(problems) },
      asClient(fake),
      NOW,
    );
    // d1-a1, d2-a1 fixed; x3 unfixable (not in plan); x4 capped.
    expect(res.changes).toHaveLength(2);
    expect(
      res.unfixable.some((u) => u.reason.includes("maximum 3 actionable")),
    ).toBe(true);
    expect(res.warnings.some((w) => w.includes("first 3"))).toBe(true);
  });
});

describe("fixer immutability and shape", () => {
  it("does not mutate plan or check", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const p = plan();
    const c = check([problemCheck("d1-a1", "Old Fort")]);
    const beforePlan = JSON.stringify(p);
    const beforeCheck = JSON.stringify(c);
    await fixTrip({ plan: p, check: c }, asClient(fake), NOW);
    expect(JSON.stringify(p)).toBe(beforePlan);
    expect(JSON.stringify(c)).toBe(beforeCheck);
  });

  it("works with deep-frozen inputs", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const p = plan();
    const c = check([problemCheck("d1-a1", "Old Fort")]);
    deepFreeze(p);
    deepFreeze(c);
    const res = await fixTrip({ plan: p, check: c }, asClient(fake), NOW);
    expect(res.changes).toHaveLength(1);
  });

  it("preserves day, time window, and kind", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d2-a1", "Old Museum")]) },
      asClient(fake),
      NOW,
    );
    const change = res.changes[0];
    expect(change?.itemId).toBe("d2-a1");
    expect(change?.dayNumber).toBe(2);
    expect(change?.action).toBe("replace_attraction");
    expect(change?.replacement.startTime).toBe("09:30");
    expect(change?.replacement.endTime).toBe("12:00");
    expect(change?.originalFinding.status).toBe("PROBLEM");
    expect(change?.originalFinding.summary.length).toBeGreaterThan(0);
  });

  it("attaches fresh evidence and reasons", async () => {
    const fake = fakeClient(() => GOOD_POOL);
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    const ev = res.changes[0]?.replacement.evidence[0];
    expect(ev?.engine).toBe("google_maps");
    expect(ev?.placeId).toBe("new1");
    expect(ev?.observedAt).toBe(NOW.toISOString());
    expect(res.changes[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("produces unfixable on research failure without fabrication", async () => {
    const fake = fakeClient(() => {
      throw new Error("down");
    });
    const res = await fixTrip(
      { plan: plan(), check: check([problemCheck("d1-a1", "Old Fort")]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toHaveLength(1);
  });
});

describe("fixer stay handling", () => {
  function stayPlan() {
    const p = plan();
    (p as unknown as Record<string, unknown>).stay = {
      hotelName: "Old Inn",
      nights: 2,
      evidence: {
        engine: "google_hotels",
        observedAt: NOW.toISOString(),
        propertyToken: "oldtok",
        query: "hotels in Jaipur",
        purpose: "stay_selection",
        currency: "INR",
        facts: { totalExtracted: 20000 },
      },
    };
    return p;
  }

  function stayProblem() {
    return {
      itemId: "stay",
      kind: "stay",
      title: "Old Inn",
      status: "PROBLEM",
      plannedEvidence: (stayPlan().stay as { evidence: unknown }).evidence,
      facts: [
        {
          fact: "hotelPrice",
          supported: true,
          outcome: "conflicting",
          detail: "Fresh total 30000 exceeds the trip budget of 25000.",
        },
      ],
      reasons: ["Fresh total 30000 exceeds the trip budget of 25000."],
    };
  }

  it("replaces a problem stay from live research", async () => {
    const fake = fakeClient(() => [], () => [
      {
        position: 1,
        name: "New Inn",
        propertyToken: "newtok",
        overallRating: 4.5,
        nightlyLowestExtracted: 4000,
      },
    ]);
    const res = await fixTrip(
      { plan: stayPlan(), check: check([stayProblem()]) },
      asClient(fake),
      NOW,
    );
    expect(fake.searchHotels).toHaveBeenCalled();
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]?.action).toBe("replace_stay");
    expect(res.changes[0]?.replacement.title).toBe("New Inn");
  });

  it("marks flexible-date stays unfixable", async () => {
    const fake = fakeClient(() => [], () => []);
    const p = stayPlan();
    (p as unknown as Record<string, unknown>).dateMode = "flexible";
    delete (p as unknown as Record<string, unknown>).startDate;
    delete (p as unknown as Record<string, unknown>).endDate;
    const res = await fixTrip(
      { plan: p, check: check([stayProblem()]) },
      asClient(fake),
      NOW,
    );
    expect(fake.searchHotels).not.toHaveBeenCalled();
    expect(res.changes).toEqual([]);
    expect(res.unfixable).toHaveLength(1);
  });

  it("keeps unknown prices unknown, never zero", async () => {
    const fake = fakeClient(() => [], () => [
      { position: 1, name: "Priceless Inn", propertyToken: "ptok" },
    ]);
    const res = await fixTrip(
      { plan: stayPlan(), check: check([stayProblem()]) },
      asClient(fake),
      NOW,
    );
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]?.replacement.cost).toBeUndefined();
  });
});

describe("fixer request validation", () => {
  it("rejects invalid requests", async () => {
    const fake = fakeClient(() => []);
    await expect(fixTrip({}, asClient(fake), NOW)).rejects.toThrow(
      ValidationError,
    );
  });
});
