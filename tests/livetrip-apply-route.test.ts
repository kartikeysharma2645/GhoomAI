/**
 * Route-level tests for POST /api/trips/active/reschedule/apply.
 * Apply is pure construction — success paths need no network.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/active/reschedule/apply/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/active/reschedule/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const TRIP = {
  tripId: "trip_test",
  status: "ACTIVE",
  activatedFrom: "APPROVED",
  activatedAt: "2026-10-05T00:00:00.000Z",
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
            evidence: [],
          },
        ],
        dayCost: { lines: [], currency: "INR" },
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  },
  currentDayNumber: 1,
  progress: [{ dayNumber: 1, items: [{ itemId: "d1-a1", status: "UPCOMING" }] }],
};

const PROPOSAL = {
  basedOnCheckedAt: "2026-10-05T00:00:00.000Z",
  situationIds: ["closed-d1-a1"],
  changes: [
    {
      itemId: "d1-a1",
      dayNumber: 1,
      action: "REPLACE_ITEM",
      originalTitle: "Old Fort",
      originalFinding: { status: "PROBLEM", summary: "Closed." },
      replacement: {
        id: "d1-a1",
        kind: "attraction",
        title: "New Palace",
        startTime: "09:30",
        endTime: "12:00",
        evidence: [
          {
            engine: "google_maps",
            observedAt: "2026-10-05T00:00:00.000Z",
            placeId: "new1",
            query: "tourist attractions in Jaipur",
            purpose: "attraction",
            facts: { rating: 4.8 },
          },
        ],
      },
      candidatesConsidered: 1,
      reasons: ["Selected New Palace."],
      recheck: {
        itemId: "d1-a1",
        kind: "attraction",
        title: "New Palace",
        status: "VERIFIED",
        facts: [],
        reasons: ["ok"],
      },
    },
  ],
  unchangedItemIds: [],
  unfixable: [],
  recheckSummary: { verified: 1, needsAttention: 0, problem: 0, unverified: 0 },
  warnings: [],
};

describe("POST /api/trips/active/reschedule/apply", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects missing changeIds with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ trip: TRIP, proposal: PROPOSAL })),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 for unknown change IDs", async () => {
    const res = await POST(
      post(
        JSON.stringify({ trip: TRIP, proposal: PROPOSAL, changeIds: ["ghost"] }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 for stale proposals", async () => {
    const renamed = structuredClone(TRIP) as typeof TRIP;
    (renamed.plan.days[0]?.items[0] as { title: string }).title = "Renamed";
    const res = await POST(
      post(
        JSON.stringify({ trip: renamed, proposal: PROPOSAL, changeIds: ["d1-a1"] }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("applies valid changes and returns the new trip", async () => {
    const res = await POST(
      post(
        JSON.stringify({ trip: TRIP, proposal: PROPOSAL, changeIds: ["d1-a1"] }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { trip: typeof TRIP; appliedChangeIds: string[] };
    };
    expect(json.ok).toBe(true);
    expect(json.data.appliedChangeIds).toEqual(["d1-a1"]);
    expect(json.data.trip.plan.days[0]?.items[0]).toMatchObject({
      id: "d1-a1",
      title: "New Palace",
    });
  });
});
