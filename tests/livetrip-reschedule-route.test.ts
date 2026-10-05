/**
 * Route-level tests for POST /api/trips/active/reschedule.
 * Validation paths only — these never reach the network.
 * Business-logic paths that construct the default gateway client stub
 * SERPAPI_KEY following the existing test convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/active/reschedule/route";

const ORIGINAL_KEY = process.env.SERPAPI_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = ORIGINAL_KEY;
});

function post(body: string): Request {
  return new Request("http://localhost/api/trips/active/reschedule", {
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

const CHECK = {
  checkedAt: "2026-10-05T00:00:00.000Z",
  destination: "Jaipur",
  status: "CLEAR",
  situations: [],
  checkedItemIds: [],
  affectedItemIds: [],
  queriesUsed: [],
  warnings: [],
};

describe("POST /api/trips/active/reschedule", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects missing liveCheck with 400", async () => {
    const res = await POST(post(JSON.stringify({ trip: TRIP })));
    expect(res.status).toBe(400);
  });

  it("rejects non-ACTIVE trips with 409", async () => {
    process.env.SERPAPI_KEY = "test-only-mock-key-not-real";
    const res = await POST(
      post(
        JSON.stringify({
          trip: { ...TRIP, status: "COMPLETED" },
          liveCheck: CHECK,
        }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("rejects destination-mismatched checks with 409", async () => {
    process.env.SERPAPI_KEY = "test-only-mock-key-not-real";
    const res = await POST(
      post(
        JSON.stringify({
          trip: TRIP,
          liveCheck: { ...CHECK, destination: "Paris" },
        }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("returns an empty proposal when nothing is actionable", async () => {
    process.env.SERPAPI_KEY = "test-only-mock-key-not-real";
    const res = await POST(
      post(JSON.stringify({ trip: TRIP, liveCheck: CHECK })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { changes: unknown[]; unfixable: unknown[]; warnings: string[] };
    };
    expect(json.ok).toBe(true);
    expect(json.data.changes).toEqual([]);
  });
});
