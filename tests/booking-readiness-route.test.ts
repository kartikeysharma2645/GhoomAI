/**
 * Route-level tests for POST /api/trips/booking-readiness.
 * Readiness is deterministic — success paths need no network.
 * Also guards the honest-handoff contract: no booking performed, no
 * confirmations, no invented provider URLs or prices.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/booking-readiness/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/booking-readiness", {
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

describe("POST /api/trips/booking-readiness", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing/invalid plan with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: { destination: "Jaipur" }, status: "APPROVED" })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid RealityCheck payload with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", check: { summary: {} } })),
    );
    expect(res.status).toBe(400);
  });

  it("returns READY for an APPROVED trip without claiming a booking", async () => {
    const res = await POST(post(JSON.stringify({ plan: PLAN, status: "APPROVED" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(json.ok).toBe(true);
    const data = json.data as {
      readiness: string;
      tripStatus: string;
      reasons: string[];
      items: Array<{ itemId: string; handoffEligible: boolean; source: null }>;
      booking: { performed: boolean; bookingId: null; confirmationCode: null };
      disclaimer: string;
    };
    expect(data.readiness).toBe("READY");
    expect(data.tripStatus).toBe("APPROVED");
    expect(data.reasons).toEqual([]);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.booking).toEqual({
      performed: false,
      bookingId: null,
      confirmationCode: null,
    });
    expect(typeof data.disclaimer).toBe("string");

    const serialized = JSON.stringify(json.data).toLowerCase();
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("confirmed");
    expect(serialized).not.toContain("confirmation code");
    expect(serialized).not.toContain("availability");
    for (const item of data.items) {
      expect(item.source).toBeNull();
    }
  });

  it("returns NOT_READY for a PLANNED trip", async () => {
    const res = await POST(post(JSON.stringify({ plan: PLAN, status: "PLANNED" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { readiness: string } };
    expect(json.data.readiness).toBe("NOT_READY");
  });

  it("returns ALREADY_ACTIVE for an ACTIVE trip", async () => {
    const res = await POST(post(JSON.stringify({ plan: PLAN, status: "ACTIVE" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { readiness: string } };
    expect(json.data.readiness).toBe("ALREADY_ACTIVE");
  });

  it("returns INVALID_STATE for an unknown status", async () => {
    const res = await POST(post(JSON.stringify({ plan: PLAN, status: "BOOKED" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { readiness: string; tripStatus: string; reasons: string[] };
    };
    expect(json.data.readiness).toBe("INVALID_STATE");
    expect(json.data.tripStatus).toBe("BOOKED");
    expect(json.data.reasons.length).toBeGreaterThan(0);
  });

  it("blocks READY when the RealityCheck exposes PROBLEM items", async () => {
    const check = {
      checkedAt: "2026-10-06T00:00:00Z",
      summary: { verified: 0, needsAttention: 0, problem: 1, unverified: 0 },
      items: [],
      warnings: [],
    };
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", check })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { readiness: string } };
    expect(json.data.readiness).toBe("NOT_READY");
  });
});
