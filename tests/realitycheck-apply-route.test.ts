/**
 * Route-level tests for POST /api/trips/reality-fix/apply.
 * Apply is pure construction — success paths need no network.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/reality-fix/apply/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/reality-fix/apply", {
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

const REPLACEMENT = {
  id: "d1-a1",
  kind: "attraction",
  title: "New Palace",
  startTime: "09:30",
  endTime: "12:00",
  place: { name: "New Palace" },
  evidence: [
    {
      engine: "google_maps",
      observedAt: "2026-10-05T00:00:00.000Z",
      placeId: "new1",
      query: "tourist attractions in Jaipur",
      purpose: "attraction",
      facts: {},
    },
  ],
};

const PROPOSAL = {
  basedOnCheckedAt: "2026-10-05T00:00:00.000Z",
  changes: [
    {
      itemId: "d1-a1",
      dayNumber: 1,
      action: "replace_attraction",
      originalTitle: "Old Fort",
      originalFinding: { status: "PROBLEM", summary: "Closed." },
      replacement: REPLACEMENT,
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

describe("POST /api/trips/reality-fix/apply", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects missing changeIds with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, proposal: PROPOSAL })),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 for unknown change IDs", async () => {
    const res = await POST(
      post(
        JSON.stringify({ plan: PLAN, proposal: PROPOSAL, changeIds: ["ghost"] }),
      ),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it("returns 409 for stale proposals", async () => {
    const firstItem = (PLAN.days[0]?.items[0] ?? {}) as Record<string, unknown>;
    const stale = {
      ...PLAN,
      days: [
        {
          ...PLAN.days[0],
          items: [{ ...firstItem, title: "Renamed" }],
        },
      ],
    };
    const res = await POST(
      post(
        JSON.stringify({ plan: stale, proposal: PROPOSAL, changeIds: ["d1-a1"] }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("applies valid changes and returns the new plan", async () => {
    const res = await POST(
      post(
        JSON.stringify({ plan: PLAN, proposal: PROPOSAL, changeIds: ["d1-a1"] }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { plan: typeof PLAN; appliedChangeIds: string[] };
    };
    expect(json.ok).toBe(true);
    expect(json.data.appliedChangeIds).toEqual(["d1-a1"]);
    expect(json.data.plan.days[0]?.items[0]).toMatchObject({
      id: "d1-a1",
      title: "New Palace",
    });
  });
});
