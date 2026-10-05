/**
 * Route-level tests for the Live Trip tracker endpoints.
 * Progress/day/complete are pure construction — success paths need no
 * network. Malformed and invalid-transition paths never reach SerpApi.
 */
import { describe, expect, it } from "vitest";
import { POST as progressPOST } from "../app/api/trips/active/progress/route";
import { POST as dayPOST } from "../app/api/trips/active/day/route";
import { POST as completePOST } from "../app/api/trips/active/complete/route";
import { formatTime } from "../app/components/LiveTripView";

function post(url: string, body: string): Request {
  return new Request(`http://localhost${url}`, {
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
      {
        dayNumber: 2,
        date: "2026-11-11",
        items: [
          {
            id: "d2-a1",
            kind: "attraction",
            title: "Old Museum",
            startTime: "09:30",
            endTime: "12:00",
            place: { name: "Old Museum" },
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
  progress: [
    { dayNumber: 1, items: [{ itemId: "d1-a1", status: "UPCOMING" }] },
    { dayNumber: 2, items: [{ itemId: "d2-a1", status: "UPCOMING" }] },
  ],
};

describe("LiveTripView helpers", () => {
  it("formats 24h times for display", () => {
    expect(formatTime("09:30")).toBe("9:30 AM");
    expect(formatTime("14:00")).toBe("2:00 PM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime("nope")).toBe("nope");
  });
});

describe("POST /api/trips/active/progress", () => {
  it("applies a valid progress update", async () => {
    const res = await progressPOST(
      post(
        "/api/trips/active/progress",
        JSON.stringify({
          trip: TRIP,
          dayNumber: 1,
          itemId: "d1-a1",
          toStatus: "IN_PROGRESS",
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: typeof TRIP;
    };
    expect(json.ok).toBe(true);
    expect(json.data.progress[0]?.items[0]?.status).toBe("IN_PROGRESS");
  });

  it("rejects malformed requests with 400", async () => {
    const res = await progressPOST(
      post("/api/trips/active/progress", JSON.stringify({})),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid transitions with 409", async () => {
    const res = await progressPOST(
      post(
        "/api/trips/active/progress",
        JSON.stringify({
          trip: TRIP,
          dayNumber: 1,
          itemId: "d1-a1",
          toStatus: "COMPLETED",
        }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("rejects unknown items with 409", async () => {
    const res = await progressPOST(
      post(
        "/api/trips/active/progress",
        JSON.stringify({
          trip: TRIP,
          dayNumber: 1,
          itemId: "ghost",
          toStatus: "SKIPPED",
        }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("rejects unknown days with 409", async () => {
    const res = await progressPOST(
      post(
        "/api/trips/active/progress",
        JSON.stringify({
          trip: TRIP,
          dayNumber: 99,
          itemId: "d1-a1",
          toStatus: "SKIPPED",
        }),
      ),
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/trips/active/day", () => {
  it("moves the current day", async () => {
    const res = await dayPOST(
      post("/api/trips/active/day", JSON.stringify({ trip: TRIP, dayNumber: 2 })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: typeof TRIP };
    expect(json.data.currentDayNumber).toBe(2);
  });

  it("rejects invalid days with 409", async () => {
    const res = await dayPOST(
      post("/api/trips/active/day", JSON.stringify({ trip: TRIP, dayNumber: 99 })),
    );
    expect(res.status).toBe(409);
  });

  it("rejects malformed requests with 400", async () => {
    const res = await dayPOST(
      post("/api/trips/active/day", JSON.stringify({})),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/trips/active/complete", () => {
  it("rejects completion while items are unresolved", async () => {
    const res = await completePOST(
      post("/api/trips/active/complete", JSON.stringify({ trip: TRIP })),
    );
    expect(res.status).toBe(409);
  });

  it("completes a resolved trip", async () => {
    const resolved = {
      ...TRIP,
      progress: [
        { dayNumber: 1, items: [{ itemId: "d1-a1", status: "SKIPPED" }] },
        { dayNumber: 2, items: [{ itemId: "d2-a1", status: "COMPLETED" }] },
      ],
    };
    const res = await completePOST(
      post("/api/trips/active/complete", JSON.stringify({ trip: resolved })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: typeof TRIP };
    expect(json.data.status).toBe("COMPLETED");
  });

  it("rejects malformed requests with 400", async () => {
    const res = await completePOST(
      post("/api/trips/active/complete", JSON.stringify({})),
    );
    expect(res.status).toBe(400);
  });
});
