/**
 * Unit tests for live-trip progress operations (Phase 6 Step 2).
 * Pure logic tests — no network. Deep-freeze tests prove inputs are
 * never mutated (production correctness never depends on freezing).
 */
import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/lib/errors";
import { activateTrip } from "../src/server/livetrip/activeTrip";
import {
  completeTrip,
  setCurrentDay,
  transitionItemProgress,
  tripSummary,
  updateItemProgress,
} from "../src/server/livetrip/progress";
import type { TripPlan } from "../src/server/trips/plan";

const NOW = new Date("2026-10-05T00:00:00.000Z");

function plan(): TripPlan {
  return {
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
          {
            id: "d1-n1",
            kind: "note",
            title: "Evening at leisure",
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
  } as TripPlan;
}

function active() {
  return activateTrip(plan(), "APPROVED", NOW);
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

describe("item progress state machine", () => {
  it("allows UPCOMING → IN_PROGRESS", () => {
    expect(transitionItemProgress("UPCOMING", "IN_PROGRESS")).toBe("IN_PROGRESS");
  });

  it("allows UPCOMING → SKIPPED", () => {
    expect(transitionItemProgress("UPCOMING", "SKIPPED")).toBe("SKIPPED");
  });

  it("allows IN_PROGRESS → COMPLETED", () => {
    expect(transitionItemProgress("IN_PROGRESS", "COMPLETED")).toBe("COMPLETED");
  });

  it("allows IN_PROGRESS → SKIPPED", () => {
    expect(transitionItemProgress("IN_PROGRESS", "SKIPPED")).toBe("SKIPPED");
  });

  it("rejects reverse transitions from terminal states", () => {
    expect(() => transitionItemProgress("COMPLETED", "IN_PROGRESS")).toThrow(
      ConflictError,
    );
    expect(() => transitionItemProgress("COMPLETED", "UPCOMING")).toThrow(
      ConflictError,
    );
    expect(() => transitionItemProgress("SKIPPED", "IN_PROGRESS")).toThrow(
      ConflictError,
    );
    expect(() => transitionItemProgress("SKIPPED", "UPCOMING")).toThrow(
      ConflictError,
    );
  });

  it("rejects unknown item IDs and day numbers", () => {
    const trip = active();
    expect(() => updateItemProgress(trip, 1, "ghost", "SKIPPED")).toThrow(
      ConflictError,
    );
    expect(() => updateItemProgress(trip, 99, "d1-a1", "SKIPPED")).toThrow(
      ConflictError,
    );
  });
});

describe("updateItemProgress", () => {
  it("returns a new state with the item moved", () => {
    const trip = active();
    const next = updateItemProgress(trip, 1, "d1-a1", "IN_PROGRESS");
    expect(next).not.toBe(trip);
    expect(
      next.progress.find((d) => d.dayNumber === 1)?.items.find((i) => i.itemId === "d1-a1")?.status,
    ).toBe("IN_PROGRESS");
  });

  it("leaves the original trip and plan unchanged", () => {
    const trip = active();
    const before = JSON.stringify(trip);
    updateItemProgress(trip, 1, "d1-a1", "SKIPPED");
    expect(JSON.stringify(trip)).toBe(before);
  });

  it("leaves unrelated items unchanged", () => {
    const trip = active();
    const next = updateItemProgress(trip, 1, "d1-a1", "SKIPPED");
    expect(
      next.progress.find((d) => d.dayNumber === 2)?.items,
    ).toEqual(trip.progress.find((d) => d.dayNumber === 2)?.items);
  });

  it("keeps nested data independent (deep copy)", () => {
    const trip = active();
    const next = updateItemProgress(trip, 1, "d1-a1", "IN_PROGRESS");
    next.plan.days[0]!.items[0]!.title = "MUTATED";
    expect(trip.plan.days[0]?.items[0]?.title).toBe("Old Fort");
  });

  it("succeeds with deep-frozen inputs", () => {
    const trip = active();
    deepFreeze(trip);
    const next = updateItemProgress(trip, 2, "d2-a1", "SKIPPED");
    expect(
      next.progress.find((d) => d.dayNumber === 2)?.items[0]?.status,
    ).toBe("SKIPPED");
  });

  it("rejects updates on non-ACTIVE trips", () => {
    const trip = active();
    const done = { ...trip, status: "COMPLETED" as const };
    expect(() => updateItemProgress(done, 1, "d1-a1", "SKIPPED")).toThrow(
      ConflictError,
    );
  });
});

describe("setCurrentDay", () => {
  it("moves the current day explicitly", () => {
    const trip = active();
    const next = setCurrentDay(trip, 2);
    expect(next.currentDayNumber).toBe(2);
    expect(trip.currentDayNumber).toBe(1);
  });

  it("rejects unknown days", () => {
    const trip = active();
    expect(() => setCurrentDay(trip, 99)).toThrow(ConflictError);
  });
});

describe("tripSummary", () => {
  it("excludes notes and counts deterministically", () => {
    let trip = active();
    trip = updateItemProgress(trip, 1, "d1-a1", "IN_PROGRESS");
    trip = updateItemProgress(trip, 1, "d1-a1", "COMPLETED");
    const summary = tripSummary(trip);
    expect(summary).toEqual({
      total: 2,
      completed: 1,
      skipped: 0,
      inProgress: 0,
      upcoming: 1,
      remaining: 1,
    });
  });
});

describe("completeTrip", () => {
  function resolved() {
    let trip = active();
    trip = updateItemProgress(trip, 1, "d1-a1", "SKIPPED");
    trip = updateItemProgress(trip, 2, "d2-a1", "IN_PROGRESS");
    trip = updateItemProgress(trip, 2, "d2-a1", "COMPLETED");
    return trip;
  }

  it("completes a fully resolved trip", () => {
    const done = completeTrip(resolved());
    expect(done.status).toBe("COMPLETED");
  });

  it("rejects completion while items are unresolved", () => {
    expect(() => completeTrip(active())).toThrow(ConflictError);
  });

  it("does not mutate the input", () => {
    const trip = resolved();
    const before = JSON.stringify(trip);
    completeTrip(trip);
    expect(JSON.stringify(trip)).toBe(before);
  });
});
