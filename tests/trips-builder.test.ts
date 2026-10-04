/**
 * Unit tests for the pure trip-planning builder.
 * Synthetic fixtures only — obviously fake names, never real travel data.
 */
import { describe, expect, it } from "vitest";
import { buildTripPlan, type BuilderInput } from "../src/server/planning/builder";
import type {
  NormalizedHotel,
  NormalizedMapsPlace,
} from "../src/server/services/serpapi/types";
import type { TripRequirements } from "../src/server/trips/requirements";

const OBSERVED_AT = "2026-10-04T00:00:00.000Z";

function place(
  title: string,
  rating: number,
  extra: Partial<NormalizedMapsPlace> = {},
): NormalizedMapsPlace {
  return {
    position: 1,
    title,
    rating,
    reviews: 100,
    address: "1 Synthetic Road",
    ...extra,
  };
}

function hotel(
  name: string,
  rating: number,
  nightly: number | undefined,
): NormalizedHotel {
  return {
    position: 1,
    name,
    overallRating: rating,
    reviews: 500,
    ...(nightly !== undefined
      ? {
          nightlyLowest: `₹${nightly}`,
          nightlyLowestExtracted: nightly,
          totalLowest: `₹${nightly * 3}`,
          totalLowestExtracted: nightly * 3,
        }
      : {}),
  };
}

function requirements(
  extra: Partial<TripRequirements> = {},
): TripRequirements {
  return {
    destination: "Jaipur",
    dateMode: "fixed",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    durationDays: 3,
    adults: 2,
    children: 0,
    interests: [],
    pace: "balanced",
    ...extra,
  };
}

function input(extra: Partial<BuilderInput> = {}): BuilderInput {
  return {
    requirements: requirements(),
    assumptions: [],
    hotels: [hotel("Synthetic Grand", 4.5, 5000)],
    attractions: [
      place("Synthetic Fort", 4.6, { placeType: "Fort" }),
      place("Synthetic Palace", 4.4, { placeType: "Palace" }),
      place("Synthetic Museum", 4.2, { placeType: "Museum" }),
      place("Synthetic Lake", 4.1),
      place("Synthetic Garden", 3.9),
      place("Synthetic Market", 3.8, { placeType: "Market" }),
    ],
    food: [place("Synthetic Eatery", 4.3)],
    currency: "INR",
    stayWindow: { checkIn: "2026-11-10", checkOut: "2026-11-12", verified: true },
    observedAt: OBSERVED_AT,
    researchWarnings: [],
    ...extra,
  };
}

function timedCount(day: { items: Array<{ kind: string }> }): number {
  return day.items.filter((i) => i.kind === "attraction").length;
}

describe("builder daily caps", () => {
  it("schedules max 2 timed attractions per day when balanced", () => {
    const plan = buildTripPlan(input());
    expect(plan.days).toHaveLength(3);
    for (const day of plan.days) {
      expect(timedCount(day)).toBeLessThanOrEqual(2);
    }
  });

  it("schedules max 1 timed attraction per day when relaxed", () => {
    const plan = buildTripPlan(
      input({ requirements: requirements({ pace: "relaxed" }) }),
    );
    for (const day of plan.days) {
      expect(timedCount(day)).toBeLessThanOrEqual(1);
    }
  });

  it("schedules max 3 timed attractions per day when packed", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      place(`Synthetic Place ${i + 1}`, 4.5),
    );
    const plan = buildTripPlan(
      input({
        requirements: requirements({ pace: "packed" }),
        attractions: many,
      }),
    );
    for (const day of plan.days) {
      expect(timedCount(day)).toBeLessThanOrEqual(3);
    }
    expect(plan.days[0] && timedCount(plan.days[0])).toBe(3);
  });
});

describe("builder ranking and pools", () => {
  it("ranks interest-matching places first", () => {
    const plan = buildTripPlan(
      input({ requirements: requirements({ interests: ["history"] }) }),
    );
    const first = plan.days[0]?.items.find((i) => i.kind === "attraction");
    expect(first?.title).toBe("Synthetic Fort");
  });

  it("creates shorter days with a warning when the pool is empty", () => {
    const plan = buildTripPlan(input({ attractions: [], food: [] }));
    expect(plan.days).toHaveLength(3);
    for (const day of plan.days) {
      expect(timedCount(day)).toBe(0);
    }
    expect(
      plan.warnings.some((w) => w.includes("shorter rather than filled")),
    ).toBe(true);
  });

  it("warns when candidates are insufficient", () => {
    const plan = buildTripPlan(
      input({ attractions: [place("Only Place", 4.5)] }),
    );
    expect(
      plan.warnings.some((w) => w.includes("Only 1 rated place")),
    ).toBe(true);
  });

  it("always includes the route-optimization warning", () => {
    const plan = buildTripPlan(input());
    expect(plan.warnings).toContain(
      "Daily activity order is not route-optimized because route distance/time data is not currently available.",
    );
  });
});

describe("builder evidence and budget", () => {
  it("attaches evidence to attraction and stay items", () => {
    const plan = buildTripPlan(input());
    const attraction = plan.days[0]?.items.find((i) => i.kind === "attraction");
    expect(attraction?.evidence).toHaveLength(1);
    expect(attraction?.evidence[0]?.engine).toBe("google_maps");
    expect(plan.stay).toBeDefined();
    expect(plan.stay?.evidence.engine).toBe("google_hotels");
    expect(plan.stay?.evidence.facts.nightlyExtracted).toBe(5000);
  });

  it("computes live totals and a within verdict", () => {
    const plan = buildTripPlan(
      input({
        requirements: requirements({ budget: { amount: 25000, currency: "INR" } }),
      }),
    );
    expect(plan.totals.liveTotal?.amount).toBe(10000);
    expect(plan.totals.liveTotal?.basis).toBe("live");
    expect(plan.budgetVerdict).toBe("within");
  });

  it("reports exceeds_live_costs over budget", () => {
    const plan = buildTripPlan(
      input({
        requirements: requirements({ budget: { amount: 1000, currency: "INR" } }),
      }),
    );
    expect(plan.budgetVerdict).toBe("exceeds_live_costs");
    expect(
      plan.warnings.some((w) => w.includes("exceeds the stated budget")),
    ).toBe(true);
  });

  it("keeps unknown costs out of the live total", () => {
    const plan = buildTripPlan(
      input({
        hotels: [hotel("Priceless Inn", 4.0, undefined)],
        requirements: requirements({ budget: { amount: 25000, currency: "INR" } }),
      }),
    );
    expect(plan.totals.liveTotal).toBeUndefined();
    expect(plan.budgetVerdict).toBe("unknown");
    expect(plan.stay?.total).toBeUndefined();
  });

  it("marks prices unverified in flexible mode", () => {
    const plan = buildTripPlan(
      input({
        requirements: requirements({
          dateMode: "flexible",
          startDate: undefined,
          endDate: undefined,
          durationDays: 3,
        }),
        stayWindow: { checkIn: "2026-11-03", checkOut: "2026-11-06", verified: false },
      }),
    );
    expect(plan.pricesVerified).toBe(false);
    expect(plan.days[0]?.date).toBeUndefined();
    expect(
      plan.warnings.some((w) => w.includes("not verified for exact travel dates")),
    ).toBe(true);
  });

  it("omits the stay section for single-day trips", () => {
    const plan = buildTripPlan(
      input({
        requirements: requirements({
          startDate: "2026-11-10",
          endDate: "2026-11-10",
          durationDays: 1,
        }),
      }),
    );
    expect(plan.days).toHaveLength(1);
    expect(plan.stay).toBeUndefined();
  });
});
