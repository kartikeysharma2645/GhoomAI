/**
 * Service-wiring tests for POST /api/trips/active/live-check.
 *
 * Purpose: prove request → validation → checkLiveSituation invocation →
 * response mapping. The service is faked at the route boundary; implementation
 * coverage lives in livetrip-livecheck.test.ts. No network.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConflictError } from "../src/lib/errors";

vi.mock("../src/server/livetrip/liveCheck", () => ({
  checkLiveSituation: vi.fn(),
}));

import { checkLiveSituation } from "../src/server/livetrip/liveCheck";
import { POST } from "../app/api/trips/active/live-check/route";

const mockCheck = vi.mocked(checkLiveSituation);

function post(body: string): Request {
  return new Request("http://localhost/api/trips/active/live-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const TRIP = {
  tripId: "trip_1",
  status: "ACTIVE",
  activatedFrom: "APPROVED",
  activatedAt: "2026-11-10T00:00:00.000Z",
  plan: {
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
  },
  currentDayNumber: 1,
  progress: [{ dayNumber: 1, items: [{ itemId: "d1-a1", status: "UPCOMING" }] }],
};

describe("POST /api/trips/active/live-check wiring", () => {
  beforeEach(() => {
    mockCheck.mockClear();
  });
  it("invokes checkLiveSituation with the trip snapshot and maps the result", async () => {
    const result = { checkedAt: "2026-11-10T09:00:00.000Z", situations: [] };
    mockCheck.mockResolvedValueOnce(result as never);
    const res = await POST(post(JSON.stringify({ trip: TRIP })));
    expect(res.status).toBe(200);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: "trip_1", status: "ACTIVE" }),
    );
    const json = (await res.json()) as { ok: boolean; data: unknown };
    expect(json.ok).toBe(true);
    expect(json.data).toEqual(result);
  });

  it("maps state conflicts to 409", async () => {
    mockCheck.mockRejectedValueOnce(new ConflictError("Trip is COMPLETED."));
    const res = await POST(post(JSON.stringify({ trip: TRIP })));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("CONFLICT");
  });
});
