/**
 * Unit tests for trip lifecycle states and the activation operation.
 * Pure logic tests — no network. Deep-freeze tests prove inputs are
 * never mutated (production correctness never depends on freezing).
 */
import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/lib/errors";
import { activateTrip } from "../src/server/livetrip/activeTrip";
import {
  canActivate,
  transition,
} from "../src/server/livetrip/lifecycle";
import type { TripPlan } from "../src/server/trips/plan";

const NOW = new Date("2026-10-05T00:00:00.000Z");

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
      {
        dayNumber: 2,
        date: "2026-11-11",
        items: [
          {
            id: "d2-a1",
            kind: "note",
            title: "Evening at leisure",
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

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

describe("lifecycle transitions", () => {
  it("allows each valid chain step", () => {
    expect(transition("DRAFT", "PLANNED")).toBe("PLANNED");
    expect(transition("PLANNED", "VERIFIED")).toBe("VERIFIED");
    expect(transition("VERIFIED", "APPROVED")).toBe("APPROVED");
    expect(transition("APPROVED", "ACTIVE")).toBe("ACTIVE");
    expect(transition("ACTIVE", "COMPLETED")).toBe("COMPLETED");
  });

  it("rejects invalid transitions", () => {
    expect(() => transition("DRAFT", "ACTIVE")).toThrow(ConflictError);
    expect(() => transition("PLANNED", "APPROVED")).toThrow(ConflictError);
    expect(() => transition("ACTIVE", "PLANNED")).toThrow(ConflictError);
    expect(() => transition("COMPLETED", "ACTIVE")).toThrow(ConflictError);
  });

  it("gates activation to VERIFIED or APPROVED", () => {
    expect(canActivate("VERIFIED")).toBe(true);
    expect(canActivate("APPROVED")).toBe(true);
    expect(canActivate("DRAFT")).toBe(false);
    expect(canActivate("PLANNED")).toBe(false);
    expect(canActivate("ACTIVE")).toBe(false);
    expect(canActivate("COMPLETED")).toBe(false);
  });
});

describe("activateTrip", () => {
  it("activates an approved plan with initialized progress", () => {
    const trip = activateTrip(plan(), "APPROVED", NOW);
    expect(trip.status).toBe("ACTIVE");
    expect(trip.activatedFrom).toBe("APPROVED");
    expect(trip.activatedAt).toBe(NOW.toISOString());
    expect(trip.tripId.length).toBeGreaterThan(0);
    expect(trip.currentDayNumber).toBe(1);
    expect(trip.progress).toHaveLength(2);
    expect(trip.progress[0]).toEqual({
      dayNumber: 1,
      items: [
        { itemId: "d1-a1", status: "UPCOMING" },
        { itemId: "d1-a2", status: "UPCOMING" },
      ],
    });
  });

  it("activates from VERIFIED and starts day 1 UPCOMING", () => {
    const trip = activateTrip(plan(), "VERIFIED", NOW);
    expect(trip.activatedFrom).toBe("VERIFIED");
    expect(trip.currentDayNumber).toBe(1);
    const statuses = trip.progress.flatMap((d) =>
      d.items.map((i) => i.status),
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(["UPCOMING"]));
  });

  it("rejects activation from invalid states", () => {
    expect(() =>
      activateTrip(plan(), "PLANNED" as never, NOW),
    ).toThrow(ConflictError);
    expect(() =>
      activateTrip(plan(), "ACTIVE" as never, NOW),
    ).toThrow(ConflictError);
  });

  it("does not mutate the source plan", () => {
    const p = plan();
    const before = JSON.stringify(p);
    activateTrip(p, "APPROVED", NOW);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("keeps nested itinerary data independent (deep copy)", () => {
    const p = plan();
    const trip = activateTrip(p, "APPROVED", NOW);
    trip.plan.days[0]!.items[0]!.title = "MUTATED";
    trip.progress[0]!.items[0]!.status = "COMPLETED";
    expect(p.days[0]?.items[0]?.title).toBe("Old Fort");
  });

  it("succeeds with deep-frozen inputs", () => {
    const p = plan();
    deepFreeze(p);
    const trip = activateTrip(p, "APPROVED", NOW);
    expect(trip.status).toBe("ACTIVE");
    expect(trip.progress).toHaveLength(2);
  });

  it("preserves stable item IDs in progress", () => {
    const trip = activateTrip(plan(), "APPROVED", NOW);
    const ids = trip.progress.flatMap((d) => d.items.map((i) => i.itemId));
    expect(ids).toEqual(["d1-a1", "d1-a2", "d2-a1"]);
  });
});
