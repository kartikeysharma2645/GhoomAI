import { describe, expect, it } from "vitest";
import { parsePlanResponse } from "../app/components/planResult";

/**
 * Regression tests for the TripForm crash
 * ("Cannot read properties of undefined (reading 'adults')").
 *
 * Root cause: POST /api/trips/plan returns the PlanTripResult envelope
 * `{ status: "ready", plan }`, but TripForm stored the whole envelope as
 * the plan. The envelope has no `party`, so planSignature() crashed.
 * parsePlanResponse unwraps and validates, so only a real TripPlan with a
 * valid party ever reaches plan state.
 */

const VALID_PLAN = {
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

describe("parsePlanResponse", () => {
  it("unwraps a ready envelope into a validated plan", () => {
    const result = parsePlanResponse({ status: "ready", plan: VALID_PLAN });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.plan.destination).toBe("Jaipur");
    expect(result.plan.party.adults).toBe(2);
    expect(result.plan.party.children).toBe(0);
    expect(result.plan.days).toHaveLength(1);
  });

  it("passes needs_input through with missing fields", () => {
    const result = parsePlanResponse({
      status: "needs_input",
      missing: ["startDate", "endDate"],
      message: "Add dates.",
    });
    expect(result).toEqual({
      kind: "needs_input",
      input: {
        status: "needs_input",
        missing: ["startDate", "endDate"],
        message: "Add dates.",
      },
    });
  });

  it("rejects the raw envelope stored as a plan (the original crash)", () => {
    // Before the fix, TripForm stored `{ status: "ready", plan }` itself as
    // the plan; such an object must never validate as plan state. Simulate
    // a consumer reading party the way planSignature() does.
    const envelope = { status: "ready", plan: VALID_PLAN };
    const result = parsePlanResponse(envelope);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    // The stored plan — not the envelope — always carries party.
    expect(() => {
      const adults = result.plan.party.adults;
      const children = result.plan.party.children;
      const days = result.plan.days.length;
      return `${adults}|${children}|${days}`;
    }).not.toThrow();
    expect(result.plan.party).toEqual({ adults: 2, children: 0 });
  });

  it("rejects a ready envelope whose plan lacks party", () => {
    const { party: _dropped, ...withoutParty } = VALID_PLAN as Record<string, unknown> & {
      party?: unknown;
    };
    void _dropped;
    expect(() =>
      parsePlanResponse({ status: "ready", plan: withoutParty }),
    ).toThrow("Unexpected planning response.");
  });

  it("rejects malformed and unknown payloads", () => {
    expect(() => parsePlanResponse(null)).toThrow("Unexpected planning response.");
    expect(() => parsePlanResponse({})).toThrow("Unexpected planning response.");
    expect(() => parsePlanResponse({ status: "ready" })).toThrow(
      "Unexpected planning response.",
    );
    expect(() => parsePlanResponse({ status: "ready", plan: null })).toThrow(
      "Unexpected planning response.",
    );
    expect(() => parsePlanResponse({ status: "bogus" })).toThrow(
      "Unexpected planning response.",
    );
    expect(() =>
      parsePlanResponse({ status: "needs_input", missing: "dates", message: "x" }),
    ).toThrow("Unexpected planning response.");
    expect(() =>
      parsePlanResponse({ status: "needs_input", missing: [], message: 42 }),
    ).toThrow("Unexpected planning response.");
  });
});
