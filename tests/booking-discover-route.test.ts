/**
 * Route-level tests for POST /api/trips/booking-discover.
 * Validation and state paths only — success paths call live SerpApi and
 * are covered by service tests with fakes plus a controlled smoke test.
 * Never reaches the network here.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/booking-discover/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/booking-discover", {
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

describe("POST /api/trips/booking-discover", () => {
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

  it("rejects a non-approved trip with 409", async () => {
    for (const status of ["DRAFT", "PLANNED", "VERIFIED", "ACTIVE", "COMPLETED"]) {
      const res = await POST(post(JSON.stringify({ plan: PLAN, status })));
      expect(res.status).toBe(409);
    }
  });

  it("rejects a plan with nothing eligible with 409, not a fake success", async () => {
    const notesOnly = {
      ...PLAN,
      days: [
        {
          dayNumber: 1,
          items: [{ id: "n1", kind: "note", title: "Rest", evidence: [] }],
          dayCost: { lines: [], currency: "INR" },
        },
      ],
    };
    const res = await POST(post(JSON.stringify({ plan: notesOnly, status: "APPROVED" })));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });
});
