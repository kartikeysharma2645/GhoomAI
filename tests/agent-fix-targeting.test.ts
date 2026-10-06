import { describe, expect, it } from "vitest";
import {
  hasPaceChangeLanguage,
  hasReplacementLanguage,
  resolveFixTargets,
} from "../src/server/agent/fixTargeting";
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
            place: { name: "Old Fort" },
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
            title: "Hawa Mahal",
            place: { name: "Hawa Mahal" },
            evidence: [],
          },
          {
            id: "d2-a2",
            kind: "attraction",
            title: "City Palace",
            place: { name: "City Palace" },
            evidence: [],
          },
          {
            id: "d2-a3",
            kind: "meal",
            title: "Lunch near Johari Bazaar",
            place: { name: "Spice House" },
            evidence: [],
          },
          {
            id: "d2-n1",
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

describe("fix targeting detectors", () => {
  it("detects replacement language", () => {
    expect(hasReplacementLanguage("Replace Hawa Mahal with another place")).toBe(true);
    expect(hasReplacementLanguage("Can you swap lunch for something else?")).toBe(true);
    expect(
      hasReplacementLanguage("Remove City Palace and find a suitable alternative"),
    ).toBe(true);
    expect(
      hasReplacementLanguage("Change the afternoon activity to something historic"),
    ).toBe(true);
    expect(hasReplacementLanguage("Fix the problems in my itinerary")).toBe(false);
    expect(hasReplacementLanguage("Check if my itinerary is realistic")).toBe(false);
  });

  it("detects pace-change language", () => {
    expect(hasPaceChangeLanguage("Day 2 is too packed")).toBe(true);
    expect(hasPaceChangeLanguage("Make it more relaxed")).toBe(true);
    expect(hasPaceChangeLanguage("Replace Hawa Mahal")).toBe(false);
  });
});

describe("resolveFixTargets", () => {
  it("targets a named item on the named day", () => {
    expect(
      resolveFixTargets(plan(), "Replace Hawa Mahal on Day 2 with another historical place"),
    ).toEqual({ kind: "targets", itemIds: ["d2-a1"] });
  });

  it("targets a named item without a day", () => {
    expect(
      resolveFixTargets(
        plan(),
        "Remove City Palace from Day 2 and find a suitable alternative",
      ),
    ).toEqual({ kind: "targets", itemIds: ["d2-a2"] });
  });

  it("treats an indefinite request on a multi-item day as ambiguous", () => {
    const result = resolveFixTargets(
      plan(),
      "I don't like Day 2. Replace one of the activities with a different historical place.",
    );
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("unreachable");
    expect(result.dayNumber).toBe(2);
    expect(result.candidates.map((c) => c.itemId).sort()).toEqual(
      ["d2-a1", "d2-a2", "d2-a3"].sort(),
    );
    // Notes are never replaceable candidates.
    expect(result.candidates.some((c) => c.itemId === "d2-n1")).toBe(false);
  });

  it("targets the only replaceable item on a single-item day", () => {
    expect(
      resolveFixTargets(plan(), "Replace it on Day 1 with something quieter"),
    ).toEqual({ kind: "targets", itemIds: ["d1-a1"] });
  });

  it("returns none when there is no replacement language", () => {
    expect(resolveFixTargets(plan(), "Fix the problems")).toEqual({ kind: "none" });
    expect(resolveFixTargets(plan(), "Day 2 is too packed")).toEqual({ kind: "none" });
  });

  it("returns ambiguous with no candidates for an empty day scope", () => {
    const result = resolveFixTargets(plan(), "Replace lunch on Day 9 with anything");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("unreachable");
    expect(result.candidates).toEqual([]);
  });
});
