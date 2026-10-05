/**
 * Unit tests for the LiveTrip reschedule apply layer (Phase 7 Prompt 3).
 * Pure construction tests — no network. Deep-freeze tests prove inputs
 * are never mutated (production correctness never depends on freezing).
 */
import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/lib/errors";
import { applyReschedule } from "../src/server/livetrip/applyReschedule";
import type { ActiveTrip } from "../src/server/livetrip/activeTrip";
import type { RescheduleProposal } from "../src/server/livetrip/reschedule";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function trip(): ActiveTrip {
  return {
    tripId: "trip_test",
    status: "ACTIVE",
    activatedFrom: "APPROVED",
    activatedAt: NOW.toISOString(),
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
  } as ActiveTrip;
}

function replacement() {
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
        observedAt: NOW.toISOString(),
        placeId: "new1",
        query: "tourist attractions in Jaipur",
        purpose: "attraction",
        facts: { rating: 4.8 },
      },
    ],
    selectionReasons: ["high rating"],
  };
}

function verifiedRecheck() {
  return {
    itemId: "d1-a1",
    kind: "attraction",
    title: "New Palace",
    status: "VERIFIED",
    facts: [],
    reasons: ["Re-identified by stable place identifier."],
  };
}

function proposal(extra: Record<string, unknown> = {}): RescheduleProposal {
  return {
    basedOnCheckedAt: NOW.toISOString(),
    situationIds: ["closed-d1-a1"],
    changes: [
      {
        itemId: "d1-a1",
        dayNumber: 1,
        action: "REPLACE_ITEM",
        originalTitle: "Old Fort",
        originalFinding: { status: "PROBLEM", summary: "Closed." },
        replacement: replacement(),
        candidatesConsidered: 1,
        reasons: ["Selected New Palace."],
        recheck: verifiedRecheck(),
      },
    ],
    unchangedItemIds: [],
    unfixable: [],
    recheckSummary: { verified: 1, needsAttention: 0, problem: 0, unverified: 0 },
    warnings: [],
    ...extra,
  } as RescheduleProposal;
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

describe("applyReschedule", () => {
  it("applies a valid single change to a new trip", () => {
    const res = applyReschedule(trip(), proposal(), ["d1-a1"]);
    expect(res.appliedChangeIds).toEqual(["d1-a1"]);
    const item = res.trip.plan.days[0]?.items.find((i) => i.id === "d1-a1");
    expect(item?.title).toBe("New Palace");
    expect(res.trip.tripId).toBe("trip_test");
    expect(res.trip.status).toBe("ACTIVE");
    expect(res.trip.currentDayNumber).toBe(1);
  });

  it("preserves untouched items and trip metadata", () => {
    const res = applyReschedule(trip(), proposal(), ["d1-a1"]);
    expect(res.trip.plan.destination).toBe("Jaipur");
    expect(res.trip.activatedAt).toBe(NOW.toISOString());
  });

  it("resets replaced progress to UPCOMING", () => {
    const res = applyReschedule(trip(), proposal(), ["d1-a1"]);
    const entry = res.trip.progress
      .find((d) => d.dayNumber === 1)
      ?.items.find((i) => i.itemId === "d1-a1");
    expect(entry?.status).toBe("UPCOMING");
  });

  it("warns when replacing an in-progress item", () => {
    const t = trip();
    const entry = t.progress[0]?.items[0];
    if (entry) entry.status = "IN_PROGRESS";
    const res = applyReschedule(t, proposal(), ["d1-a1"]);
    expect(res.warnings.some((w) => w.includes("in progress"))).toBe(true);
    expect(
      res.trip.progress[0]?.items.find((i) => i.itemId === "d1-a1")?.status,
    ).toBe("UPCOMING");
  });

  it("refuses already completed items", () => {
    const t = trip();
    const entry = t.progress[0]?.items[0];
    if (entry) entry.status = "COMPLETED";
    expect(() => applyReschedule(t, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("refuses already skipped items", () => {
    const t = trip();
    const entry = t.progress[0]?.items[0];
    if (entry) entry.status = "SKIPPED";
    expect(() => applyReschedule(t, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("rejects unknown change IDs", () => {
    expect(() => applyReschedule(trip(), proposal(), ["ghost"])).toThrow(
      ConflictError,
    );
  });

  it("rejects empty changeIds", () => {
    expect(() => applyReschedule(trip(), proposal(), [])).toThrow(
      ConflictError,
    );
  });

  it("rejects removed items atomically", () => {
    const t = trip();
    const day = t.plan.days[0];
    if (day) day.items = [];
    expect(() => applyReschedule(t, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("rejects renamed items", () => {
    const t = trip();
    const item = t.plan.days[0]?.items[0];
    if (item) item.title = "Renamed Fort";
    expect(() => applyReschedule(t, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("rejects unverified replacements", () => {
    const p = proposal();
    const change = p.changes[0];
    if (change) {
      change.recheck = {
        ...verifiedRecheck(),
        status: "UNVERIFIED",
        reasons: ["Not checked."],
      };
    }
    expect(() => applyReschedule(trip(), p, ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("rejects non-ACTIVE trips", () => {
    const t = { ...trip(), status: "COMPLETED" } as ActiveTrip;
    expect(() => applyReschedule(t, proposal(), ["d1-a1"])).toThrow(
      ConflictError,
    );
  });

  it("does not mutate inputs, even frozen", () => {
    const t = trip();
    const p = proposal();
    deepFreeze(t);
    deepFreeze(p);
    const beforeTrip = JSON.stringify(t);
    const beforeProposal = JSON.stringify(p);
    const res = applyReschedule(t, p, ["d1-a1"]);
    expect(JSON.stringify(t)).toBe(beforeTrip);
    expect(JSON.stringify(p)).toBe(beforeProposal);
    expect(res.trip.plan.days[0]?.items[0]?.title).toBe("New Palace");
  });

  it("applies multiple changes atomically", () => {
    const t = trip();
    t.plan.days[0]?.items.push({
      id: "d1-a2",
      kind: "attraction",
      title: "Old Garden",
      startTime: "14:00",
      endTime: "16:30",
      place: { name: "Old Garden" },
      evidence: [],
    });
    t.progress[0]?.items.push({ itemId: "d1-a2", status: "UPCOMING" });
    const p = proposal();
    const second = {
      ...(p.changes[0] as Record<string, unknown>),
      itemId: "ghost-missing",
      originalTitle: "Ghost",
    } as never;
    p.changes.push(second);
    expect(() => applyReschedule(t, p, ["d1-a1", "ghost-missing"])).toThrow(
      ConflictError,
    );
    expect(t.plan.days[0]?.items.find((i) => i.id === "d1-a1")?.title).toBe(
      "Old Fort",
    );
  });
});
