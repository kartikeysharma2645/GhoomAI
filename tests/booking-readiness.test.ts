/**
 * Phase 9 Prompt 1 service tests: deterministic booking-readiness evaluation.
 * Pure construction — no network, no SerpApi, no storage.
 */
import { describe, expect, it } from "vitest";
import {
  collectHandoffItems,
  evaluateBookingReadiness,
} from "../src/server/booking/readiness";
import type { TripPlan } from "../src/server/trips/plan";

const BASE_PLAN = {
  destination: "Jaipur",
  dateMode: "fixed",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  durationDays: 3,
  party: { adults: 2, children: 0 },
  budgetVerdict: "within",
  assumptions: [],
  warnings: [],
  stay: {
    hotelName: "Lake Palace",
    nights: 2,
    evidence: { engine: "google_hotels", observedAt: "2026-10-06T00:00:00Z", facts: {} },
  },
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
        {
          id: "d1-n1",
          kind: "note",
          title: "Rest in the evening",
          evidence: [],
        },
      ],
      dayCost: { lines: [], currency: "INR" },
    },
  ],
  totals: { lines: [], currency: "INR" },
  pricesVerified: true,
} as unknown as TripPlan;

const CLEAN_CHECK = {
  checkedAt: "2026-10-06T00:00:00Z",
  summary: { verified: 1, needsAttention: 1, problem: 0, unverified: 0 },
  items: [],
  warnings: [],
};

const BLOCKED_CHECK = {
  ...CLEAN_CHECK,
  summary: { verified: 0, needsAttention: 0, problem: 2, unverified: 0 },
};

describe("evaluateBookingReadiness", () => {
  it("marks an APPROVED trip with actionable items READY", () => {
    const result = evaluateBookingReadiness({ plan: BASE_PLAN, status: "APPROVED" });
    expect(result.readiness).toBe("READY");
    expect(result.reasons).toEqual([]);
    expect(result.tripStatus).toBe("APPROVED");
    const eligible = result.items.filter((i) => i.handoffEligible);
    expect(eligible.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.source).toBeNull();
      if (item.handoffEligible) {
        expect(item.searchHint).toContain("Jaipur");
      }
    }
  });

  it.each(["DRAFT", "PLANNED", "VERIFIED"] as const)(
    "rejects %s as NOT_READY pending approval",
    (status) => {
      const result = evaluateBookingReadiness({ plan: BASE_PLAN, status });
      expect(result.readiness).toBe("NOT_READY");
      expect(result.reasons.join(" ")).toMatch(/approve/i);
    },
  );

  it("reports ALREADY_ACTIVE for an ACTIVE trip", () => {
    const result = evaluateBookingReadiness({ plan: BASE_PLAN, status: "ACTIVE" });
    expect(result.readiness).toBe("ALREADY_ACTIVE");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("reports NOT_READY for a COMPLETED trip", () => {
    const result = evaluateBookingReadiness({ plan: BASE_PLAN, status: "COMPLETED" });
    expect(result.readiness).toBe("NOT_READY");
    expect(result.reasons.join(" ")).toMatch(/completed/i);
  });

  it("reports INVALID_STATE for an unknown status", () => {
    const result = evaluateBookingReadiness({ plan: BASE_PLAN, status: "BOOKED" });
    expect(result.readiness).toBe("INVALID_STATE");
    expect(result.items).toEqual([]);
  });

  it("rejects an APPROVED trip with no actionable items", () => {
    const plan = {
      ...BASE_PLAN,
      stay: undefined,
      days: [
        {
          dayNumber: 1,
          items: [{ id: "n1", kind: "note", title: "Free day", evidence: [] }],
          dayCost: { lines: [], currency: "INR" },
        },
      ],
    } as unknown as TripPlan;
    const result = evaluateBookingReadiness({ plan, status: "APPROVED" });
    expect(result.readiness).toBe("NOT_READY");
    expect(result.reasons.join(" ")).toMatch(/no actionable/i);
  });

  it("rejects an APPROVED fixed-date trip missing its dates", () => {
    const plan = { ...BASE_PLAN, startDate: undefined, endDate: undefined };
    const result = evaluateBookingReadiness({ plan, status: "APPROVED" });
    expect(result.readiness).toBe("NOT_READY");
    expect(result.reasons.join(" ")).toMatch(/date/i);
  });

  it("blocks on unresolved PROBLEM findings but not on NEEDS_ATTENTION", () => {
    const blocked = evaluateBookingReadiness({
      plan: BASE_PLAN,
      status: "APPROVED",
      check: BLOCKED_CHECK,
    });
    expect(blocked.readiness).toBe("NOT_READY");
    expect(blocked.reasons.join(" ")).toMatch(/blocking/i);

    const clean = evaluateBookingReadiness({
      plan: BASE_PLAN,
      status: "APPROVED",
      check: CLEAN_CHECK,
    });
    expect(clean.readiness).toBe("READY");
  });
});

describe("collectHandoffItems", () => {
  it("marks notes ineligible and never invents provider sources", () => {
    const items = collectHandoffItems(BASE_PLAN);
    const note = items.find((i) => i.itemId === "d1-n1");
    expect(note?.handoffEligible).toBe(false);
    expect(note?.ineligibilityReason).toMatch(/nothing to book/i);
    for (const item of items) {
      expect(item.source).toBeNull();
      expect(item).not.toHaveProperty("url");
      expect(item).not.toHaveProperty("price");
    }
  });
});
