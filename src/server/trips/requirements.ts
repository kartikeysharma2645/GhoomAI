import { z } from "zod";
import { ValidationError } from "../../lib/errors";
import { TRIP_INTERESTS } from "../interests";
import { parseIsoCalendarDate } from "../services/serpapi/types";

/**
 * Phase 4 Step 1 trip requirements.
 *
 * `TripPlanRequest` is the loose caller input. `resolveRequirements()`
 * validates it into a canonical `TripRequirements` or returns a structured
 * `needs_input` result — never silently plans with missing critical data.
 * Pure: no network, no secrets. `now` is injectable for tests.
 */

export const TRAVEL_PACES = ["relaxed", "balanced", "packed"] as const;

const MAX_PARTY_ADULTS = 16;
const MAX_PARTY_CHILDREN = 10;
const MAX_PARTY_TEENAGERS = 10;
const MAX_PARTY_SENIORS = 10;
const MAX_TRIP_DAYS = 30;

export const tripPlanRequestSchema = z.object({
  destination: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  flexibleDates: z.boolean().optional(),
  durationDays: z.number().int().min(1).max(MAX_TRIP_DAYS).optional(),
  adults: z.number().int().min(1).max(MAX_PARTY_ADULTS).optional(),
  children: z.number().int().min(0).max(MAX_PARTY_CHILDREN).optional(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
  teenagers: z.number().int().min(0).max(MAX_PARTY_TEENAGERS).optional(),
  seniors: z.number().int().min(0).max(MAX_PARTY_SENIORS).optional(),
  budget: z
    .object({
      amount: z.number().positive().max(1_000_000_000),
      currency: z.string().length(3).optional(),
    })
    .optional(),
  interests: z.array(z.enum(TRIP_INTERESTS)).max(6).optional(),
  pace: z.enum(TRAVEL_PACES).optional(),
  accommodation: z
    .object({
      type: z.enum(["hotel", "any"]).optional(),
      maxNightly: z.number().positive().max(1_000_000_000).optional(),
    })
    .optional(),
});

export type TripPlanRequest = z.infer<typeof tripPlanRequestSchema>;

export const tripRequirementsSchema = z.object({
  destination: z.string().min(1).max(200),
  dateMode: z.enum(["fixed", "flexible"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.number().int().min(1).max(MAX_TRIP_DAYS),
  adults: z.number().int().min(1).max(MAX_PARTY_ADULTS),
  children: z.number().int().min(0).max(MAX_PARTY_CHILDREN),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
  // Optional for backward compatibility with older stored requirements;
  // resolveRequirements always fills them (default 0) for new requests.
  teenagers: z.number().int().min(0).max(MAX_PARTY_TEENAGERS).optional(),
  seniors: z.number().int().min(0).max(MAX_PARTY_SENIORS).optional(),
  budget: z
    .object({
      amount: z.number().positive().max(1_000_000_000),
      currency: z.string().length(3),
    })
    .optional(),
  interests: z.array(z.enum(TRIP_INTERESTS)),
  pace: z.enum(TRAVEL_PACES),
  accommodation: z
    .object({
      type: z.enum(["hotel", "any"]),
      maxNightly: z.number().positive().max(1_000_000_000).optional(),
    })
    .optional(),
});

export type TripRequirements = z.infer<typeof tripRequirementsSchema>;

export type MissingField =
  | "destination"
  | "startDate"
  | "endDate"
  | "durationDays";

export type RequirementsResolution =
  | {
      status: "ready";
      requirements: TripRequirements;
      assumptions: string[];
    }
  | { status: "needs_input"; missing: MissingField[]; message: string };

function startOfDayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Validates caller input into canonical requirements.
 * Missing destination, or missing/invalid/unusable dates, yield
 * `needs_input` — the planner must ask, never guess.
 */
export function resolveRequirements(
  input: TripPlanRequest,
  now: Date = new Date(),
): RequirementsResolution {
  const destination = input.destination?.trim() || undefined;
  if (!destination) {
    return {
      status: "needs_input",
      missing: ["destination"],
      message: "Tell us your destination to start planning the trip.",
    };
  }

  const assumptions: string[] = [];
  const adults = input.adults ?? 2;
  if (input.adults === undefined) assumptions.push("Assuming 2 adults.");
  const pace = input.pace ?? "balanced";
  if (input.pace === undefined) assumptions.push("Assuming balanced pace.");

  const children = input.children ?? 0;
  const childrenAges = input.childrenAges;
  if (childrenAges !== undefined && childrenAges.length !== children) {
    throw new ValidationError(
      "childrenAges length must match the children count.",
    );
  }
  const teenagers = input.teenagers ?? 0;
  const seniors = input.seniors ?? 0;
  if (teenagers > 0 || seniors > 0) {
    // Explicit provider limitation, not a silent conversion: hotel search
    // supports adults and children (0–17) only, so teenager/senior counts
    // are preserved for planning while room occupancy stays unverified.
    assumptions.push(
      "Hotel search covers adults and children (0–17) only — teenager/senior counts are kept for planning; confirm room occupancy with the provider.",
    );
  }

  const currency = (input.budget?.currency ?? "INR").toUpperCase();
  const budget = input.budget
    ? { amount: input.budget.amount, currency }
    : undefined;

  const base = {
    destination,
    adults,
    children,
    childrenAges,
    teenagers,
    seniors,
    budget,
    interests: input.interests ?? [],
    pace,
    accommodation: input.accommodation
      ? {
          type: input.accommodation.type ?? "any",
          maxNightly: input.accommodation.maxNightly,
        }
      : undefined,
  };

  if (input.flexibleDates === true) {
    if (input.durationDays === undefined) {
      return {
        status: "needs_input",
        missing: ["durationDays"],
        message:
          "For flexible dates, tell us how many days the trip should last.",
      };
    }
    assumptions.push(
      "Flexible dates: planning by day numbers; hotel prices cannot be verified without exact dates.",
    );
    return {
      status: "ready",
      requirements: tripRequirementsSchema.parse({
        ...base,
        dateMode: "flexible",
        durationDays: input.durationDays,
      }),
      assumptions,
    };
  }

  if (!input.startDate || !input.endDate) {
    const missing: MissingField[] = [];
    if (!input.startDate) missing.push("startDate");
    if (!input.endDate) missing.push("endDate");
    return {
      status: "needs_input",
      missing,
      message: "Tell us your trip start and end dates (YYYY-MM-DD).",
    };
  }
  const ci = parseIsoCalendarDate(input.startDate);
  const co = parseIsoCalendarDate(input.endDate);
  if (!ci || !co) {
    return {
      status: "needs_input",
      missing: ["startDate", "endDate"],
      message: "Trip dates must be valid YYYY-MM-DD calendar dates.",
    };
  }
  const inMs = Date.UTC(ci.y, ci.m - 1, ci.d);
  const outMs = Date.UTC(co.y, co.m - 1, co.d);
  if (outMs <= inMs) {
    return {
      status: "needs_input",
      missing: ["startDate", "endDate"],
      message: "The trip end date must be after the start date.",
    };
  }
  if (outMs < startOfDayUtc(now)) {
    return {
      status: "needs_input",
      missing: ["startDate", "endDate"],
      message: "Trip dates are in the past. Provide upcoming dates.",
    };
  }
  const durationDays = Math.round((outMs - inMs) / 86_400_000) + 1;
  if (durationDays > MAX_TRIP_DAYS) {
    return {
      status: "needs_input",
      missing: ["startDate", "endDate"],
      message: `Trips longer than ${MAX_TRIP_DAYS} days are not supported yet.`,
    };
  }

  return {
    status: "ready",
    requirements: tripRequirementsSchema.parse({
      ...base,
      dateMode: "fixed",
      startDate: input.startDate,
      endDate: input.endDate,
      durationDays,
    }),
    assumptions,
  };
}
