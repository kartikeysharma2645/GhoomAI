/**
 * Unit tests for the RealityCheck apply layer (Phase 5 Step 4).
 * Pure construction tests — no network. Deep-freeze tests prove inputs
 * are never mutated (production correctness never depends on freezing).
 */
import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/lib/errors";
import { applyReplanProposal } from "../src/server/realitycheck/apply";
import type { ItemCheck } from "../src/server/realitycheck/checks";
import type { ReplanProposal } from "../src/server/realitycheck/proposal";
import type { TripPlan } from "../src/server/trips/plan";

function plan(): TripPlan {
  return {
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
          {
            id: "d1-a2",
            kind: "attraction",
            title: "Old Garden",
            startTime: "14:00",
            endTime: "16:30",
            place: { name: "Old Garden" },
            evidence: [],
          },
        ],
        dayCost: { lines: [], currency: "INR" },
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  } as TripPlan;
}

function replacementItem() {
  return {
    id: "d1-a1",
    kind: "attraction",
    title: "New Palace",
    startTime: "09:30",
    endTime: "12:00",
    place: { name: "New Palace", rating: 4.8 },
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
    selectionReasons: ["high rating"],
  };
}

function verifiedRecheck(): ItemCheck {
  return {
    itemId: "d1-a1",
    kind: "attraction",
    title: "New Palace",
    status: "VERIFIED",
    facts: [],
    reasons: ["Re-identified by stable place identifier."],
  };
}

function proposal(extra: Record<string, unknown> = {}): ReplanProposal {
  return {
    basedOnCheckedAt: "2026-10-05T00:00:00.000Z",
    changes: [
      {
        itemId: "d1-a1",
        dayNumber: 1,
        action: "replace_attraction",
        originalTitle: "Old Fort",
        originalFinding: { status: "PROBLEM", summary: "Closed." },
        replacement: replacementItem(),
        candidatesConsidered: 1,
        reasons: ["Selected New Palace."],
        recheck: verifiedRecheck(),
      },
    ],
    unchangedItemIds: ["d1-a2"],
    unfixable: [],
    recheckSummary: { verified: 1, needsAttention: 0, problem: 0, unverified: 0 },
    warnings: [],
    ...extra,
  } as ReplanProposal;
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

describe("applyReplanProposal", () => {
  it("applies a valid single change", () => {
    const res = applyReplanProposal(plan(), proposal(), ["d1-a1"]);
    expect(res.appliedChangeIds).toEqual(["d1-a1"]);
    const item = res.plan.days[0]?.items.find((i) => i.id === "d1-a1");
    expect(item?.title).toBe("New Palace");
  });

  it("preserves untouched items and metadata", () => {
    const res = applyReplanProposal(plan(), proposal(), ["d1-a1"]);
    expect(
      res.plan.days[0]?.items.find((i) => i.id === "d1-a2")?.title,
    ).toBe("Old Garden");
    expect(res.plan.destination).toBe("Jaipur");
    expect(res.plan.days).toHaveLength(1);
    expect(res.plan.budgetVerdict).toBe("within");
  });

  it("does not mutate the input plan or proposal", () => {
    const p = plan();
    const prop = proposal();
    const beforePlan = JSON.stringify(p);
    const beforeProposal = JSON.stringify(prop);
    applyReplanProposal(p, prop, ["d1-a1"]);
    expect(JSON.stringify(p)).toBe(beforePlan);
    expect(JSON.stringify(prop)).toBe(beforeProposal);
  });

  it("succeeds with deep-frozen inputs", () => {
    const p = plan();
    const prop = proposal();
    deepFreeze(p);
    deepFreeze(prop);
    const res = applyReplanProposal(p, prop, ["d1-a1"]);
    expect(res.plan.days[0]?.items.find((i) => i.id === "d1-a1")?.title).toBe(
      "New Palace",
    );
  });

  it("rejects stale item IDs", async () => {
    await expect(async () =>
      applyReplanProposal(plan(), proposal(), ["missing-id"]),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects original-item title mismatch", () => {
    const p = plan();
    const dayItem = p.days[0]?.items.find((i) => i.id === "d1-a1");
    if (dayItem) dayItem.title = "Renamed Fort";
    expect(() => applyReplanProposal(p, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("rejects incompatible proposals atomically", () => {
    const prop = proposal();
    prop.changes.push({
      ...(prop.changes[0] as Record<string, unknown>),
      itemId: "ghost",
      originalTitle: "Ghost",
    } as never);
    const p = plan();
    expect(() => applyReplanProposal(p, prop, ["d1-a1", "ghost"])).toThrow(
      ConflictError,
    );
    // Nothing applied: original untouched.
    expect(p.days[0]?.items.find((i) => i.id === "d1-a1")?.title).toBe(
      "Old Fort",
    );
  });

  it("rejects unverified replacements", () => {
    const prop = proposal();
    const change = prop.changes[0];
    if (change) {
      change.recheck = {
        ...verifiedRecheck(),
        status: "UNVERIFIED",
        reasons: ["Not checked."],
      };
    }
    expect(() => applyReplanProposal(plan(), prop, ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("applies only selected changeIds", () => {
    const prop = proposal();
    prop.changes.push({
      ...(prop.changes[0] as Record<string, unknown>),
      itemId: "d1-a2",
      originalTitle: "Old Garden",
      replacement: {
        ...(replacementItem() as Record<string, unknown>),
        id: "d1-a2",
        title: "New Garden",
      },
    } as never);
    const res = applyReplanProposal(plan(), prop, ["d1-a2"]);
    expect(res.appliedChangeIds).toEqual(["d1-a2"]);
    expect(res.plan.days[0]?.items.find((i) => i.id === "d1-a1")?.title).toBe(
      "Old Fort",
    );
    expect(res.plan.days[0]?.items.find((i) => i.id === "d1-a2")?.title).toBe(
      "New Garden",
    );
  });

  it("rejects empty changeIds", () => {
    expect(() => applyReplanProposal(plan(), proposal(), [])).toThrow(
      ConflictError,
    );
  });

  it("applies stay replacements to the stay section", () => {
    const p = plan();
    (p as unknown as Record<string, unknown>).stay = {
      hotelName: "Old Inn",
      nights: 2,
      evidence: {
        engine: "google_hotels",
        observedAt: "2026-10-05T00:00:00.000Z",
        purpose: "stay_selection",
        currency: "INR",
        facts: {},
      },
    };
    const prop = proposal();
    prop.changes = [
      {
        itemId: "stay",
        dayNumber: 1,
        action: "replace_stay",
        originalTitle: "Old Inn",
        originalFinding: { status: "PROBLEM", summary: "Over budget." },
        replacement: {
          id: "stay",
          kind: "stay",
          title: "New Inn",
          place: { name: "New Inn", rating: 4.5 },
          evidence: [
            {
              engine: "google_hotels",
              observedAt: "2026-10-05T00:00:00.000Z",
              propertyToken: "newtok",
              query: "hotels in Jaipur",
              purpose: "stay_selection",
              currency: "INR",
              facts: { nightlyExtracted: 4000 },
            },
          ],
          cost: {
            label: "Stay",
            amount: 8000,
            currency: "INR",
            basis: "live",
          },
        },
        candidatesConsidered: 1,
        reasons: ["Selected New Inn."],
        recheck: { ...verifiedRecheck(), itemId: "stay", title: "New Inn" },
      },
    ];
    const res = applyReplanProposal(p, prop, ["stay"]);
    expect(res.plan.stay?.hotelName).toBe("New Inn");
    expect(res.plan.stay?.nights).toBe(2);
    expect(res.plan.stay?.total?.amount).toBe(8000);
  });
});
