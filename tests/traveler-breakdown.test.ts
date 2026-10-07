/**
 * Traveler-breakdown regression tests (adults / children 0–12 /
 * teenagers 13–19 / seniors 60+).
 *
 * Pure/server + pure-render tests only — no network. Teenagers and
 * seniors are preserved end-to-end (request → requirements → plan →
 * summary) but NEVER folded into the hotel provider's adults/children
 * contract; that limitation stays explicit via a requirements assumption.
 */
import { describe, expect, it, vi } from "vitest";
import { extractPlanRequest } from "../src/server/agent/orchestrator";
import { researchHotels } from "../src/server/research/hotels";
import type { TripRequirements } from "../src/server/trips/requirements";
import {
  resolveRequirements,
  tripPlanRequestSchema,
} from "../src/server/trips/requirements";
import { tripPlanSchema } from "../src/server/trips/plan";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { formatPartyLabel } from "../app/components/ItineraryView";

function baseRequest() {
  return {
    destination: "Jaipur",
    flexibleDates: true,
    durationDays: 3,
  };
}

describe("traveler request validation", () => {
  it("keeps existing adults-only requests valid with zero defaults", () => {
    const parsed = tripPlanRequestSchema.safeParse({ ...baseRequest(), adults: 2 });
    expect(parsed.success).toBe(true);
    const res = resolveRequirements({ ...baseRequest(), adults: 2 });
    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("unreachable");
    expect(res.requirements.adults).toBe(2);
    expect(res.requirements.children).toBe(0);
    expect(res.requirements.teenagers).toBe(0);
    expect(res.requirements.seniors).toBe(0);
  });

  it("validates a full traveler breakdown", () => {
    const res = resolveRequirements({
      ...baseRequest(),
      adults: 2,
      children: 2,
      teenagers: 1,
      seniors: 1,
    });
    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("unreachable");
    expect(res.requirements).toMatchObject({
      adults: 2,
      children: 2,
      teenagers: 1,
      seniors: 1,
    });
  });

  it("rejects negative traveler counts", () => {
    for (const bad of [
      { adults: -1 },
      { children: -1 },
      { teenagers: -1 },
      { seniors: -1 },
    ]) {
      expect(tripPlanRequestSchema.safeParse({ ...baseRequest(), ...bad }).success).toBe(
        false,
      );
    }
  });

  it("rejects zero adults", () => {
    expect(
      tripPlanRequestSchema.safeParse({ ...baseRequest(), adults: 0 }).success,
    ).toBe(false);
  });

  it("rejects over-limit teenager/senior counts", () => {
    expect(
      tripPlanRequestSchema.safeParse({ ...baseRequest(), teenagers: 11 }).success,
    ).toBe(false);
    expect(
      tripPlanRequestSchema.safeParse({ ...baseRequest(), seniors: 11 }).success,
    ).toBe(false);
  });
});

describe("traveler summary labels", () => {
  it("omits zero-value categories, preserving the clean adults format", () => {
    expect(formatPartyLabel({ adults: 2, children: 0 })).toBe("2 adults");
    expect(
      formatPartyLabel({ adults: 1, children: 0, teenagers: 0, seniors: 0 }),
    ).toBe("1 adult");
  });

  it("displays every non-zero category exactly once", () => {
    expect(
      formatPartyLabel({ adults: 2, children: 2, teenagers: 1, seniors: 1 }),
    ).toBe("2 adults · 2 children · 1 teenager · 1 senior");
    expect(formatPartyLabel({ adults: 2, children: 0, seniors: 1 })).toBe(
      "2 adults · 1 senior",
    );
    expect(
      formatPartyLabel({ adults: 2, children: 1, teenagers: 2 }),
    ).toBe("2 adults · 1 child · 2 teenagers");
  });
});

describe("stored-plan compatibility", () => {
  const oldPlan = {
    destination: "Jaipur",
    dateMode: "fixed",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    durationDays: 3,
    party: { adults: 2, children: 0 },
    budgetVerdict: "within",
    assumptions: [],
    warnings: [],
    days: [],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  };

  it("parses pre-breakdown plans without failing", () => {
    const parsed = tripPlanSchema.safeParse(oldPlan);
    expect(parsed.success).toBe(true);
  });

  it("round-trips the full breakdown through the plan schema", () => {
    const parsed = tripPlanSchema.safeParse({
      ...oldPlan,
      party: { adults: 2, children: 2, teenagers: 1, seniors: 1 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("unreachable");
    expect(parsed.data.party).toMatchObject({
      adults: 2,
      children: 2,
      teenagers: 1,
      seniors: 1,
    });
  });
});

describe("agent natural-language extraction", () => {
  it("extracts the full breakdown deterministically", () => {
    expect(
      extractPlanRequest(
        "Plan a 3-day trip to Jaipur for 2 adults, 2 children and 1 senior",
      ),
    ).toMatchObject({ adults: 2, children: 2, seniors: 1 });
    expect(
      extractPlanRequest("Plan 2 days in Goa for 2 adults and 1 teenager"),
    ).toMatchObject({ adults: 2, teenagers: 1 });
    expect(
      extractPlanRequest("Plan 2 days in Goa for 2 adults and 3 teens"),
    ).toMatchObject({ adults: 2, teenagers: 3 });
  });

  it("leaves new categories undefined when unstated", () => {
    const req = extractPlanRequest("Plan 3 days in Jaipur for 2 adults");
    expect(req.teenagers).toBeUndefined();
    expect(req.seniors).toBeUndefined();
  });
});

describe("hotel provider mapping honesty", () => {
  function requirements(): TripRequirements {
    return {
      destination: "Jaipur",
      dateMode: "fixed",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      durationDays: 3,
      adults: 2,
      children: 2,
      teenagers: 1,
      seniors: 1,
      interests: [],
      pace: "balanced",
    };
  }

  it("never folds teenagers/seniors into the provider call", async () => {
    const searchHotels = vi.fn().mockResolvedValue({ results: [] });
    const client = { searchHotels } as unknown as SerpApiClient;
    await researchHotels(
      client,
      requirements(),
      { checkIn: "2026-11-10", checkOut: "2026-11-12", verified: true },
      "INR",
    );
    expect(searchHotels).toHaveBeenCalledTimes(1);
    const arg = searchHotels.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.adults).toBe(2);
    expect(arg.children).toBe(2);
    expect("teenagers" in arg).toBe(false);
    expect("seniors" in arg).toBe(false);
  });

  it("states the hotel limitation explicitly instead of converting silently", () => {
    const withExtra = resolveRequirements({
      ...baseRequest(),
      adults: 2,
      teenagers: 1,
      seniors: 1,
    });
    expect(withExtra.status).toBe("ready");
    if (withExtra.status !== "ready") throw new Error("unreachable");
    expect(
      withExtra.assumptions.some((a) => a.includes("Hotel search covers")),
    ).toBe(true);
    const adultsOnly = resolveRequirements({ ...baseRequest(), adults: 2 });
    expect(adultsOnly.status).toBe("ready");
    if (adultsOnly.status !== "ready") throw new Error("unreachable");
    expect(
      adultsOnly.assumptions.some((a) => a.includes("Hotel search covers")),
    ).toBe(false);
  });
});
