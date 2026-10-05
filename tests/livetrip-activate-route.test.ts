/**
 * Route-level tests for POST /api/trips/activate.
 * Activation is pure construction — success paths need no network.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/activate/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const PLAN = {
  destination: "Jaipur",
  dateMode: "fixed",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  durationDays: 3,
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
};

describe("POST /api/trips/activate", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects a non-activatable status with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, fromStatus: "DRAFT" })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid plan with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: { destination: "Jaipur" }, fromStatus: "APPROVED" })),
    );
    expect(res.status).toBe(400);
  });

  it("activates an approved plan and returns the contract", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, fromStatus: "APPROVED" })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        tripId: string;
        status: string;
        currentDayNumber: number;
        progress: Array<{ dayNumber: number; items: Array<{ itemId: string; status: string }> }>;
        plan: typeof PLAN;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ACTIVE");
    expect(json.data.currentDayNumber).toBe(1);
    expect(json.data.progress).toEqual([
      { dayNumber: 1, items: [{ itemId: "d1-a1", status: "UPCOMING" }] },
    ]);
    expect(json.data.plan.destination).toBe("Jaipur");
  });
});
