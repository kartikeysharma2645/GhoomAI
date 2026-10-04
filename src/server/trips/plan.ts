import { z } from "zod";

/**
 * Phase 4 Step 1 trip plan contract — the smallest robust model that can
 * support itinerary generation now and RealityCheck verification later.
 *
 * Rules:
 * - Every attraction/stay item carries `evidence` (normalized only).
 * - Costs carry a `basis`: live values and estimates are never mixed.
 * - Unknown costs are omitted, never invented.
 */

export const COST_BASES = ["live", "estimated", "unknown"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const costLineSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().nonnegative().optional(),
  currency: z.string().length(3),
  basis: z.enum(COST_BASES),
});

export type CostLine = z.infer<typeof costLineSchema>;

export const costBreakdownSchema = z.object({
  lines: z.array(costLineSchema),
  liveTotal: costLineSchema.optional(),
  estimatedTotal: costLineSchema.optional(),
  currency: z.string().length(3),
});

export type CostBreakdown = z.infer<typeof costBreakdownSchema>;

export const evidenceSchema = z.object({
  engine: z.enum(["google", "google_maps", "google_hotels"]),
  observedAt: z.string(),
  placeId: z.string().optional(),
  propertyToken: z.string().optional(),
  sourceUrl: z.string().optional(),
  facts: z.object({
    rating: z.number().optional(),
    reviews: z.number().optional(),
    nightlyExtracted: z.number().optional(),
    totalExtracted: z.number().optional(),
    address: z.string().optional(),
    hours: z.record(z.string(), z.string()).optional(),
    openState: z.string().optional(),
  }),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const ITINERARY_KINDS = ["attraction", "meal", "stay", "note"] as const;

export const itineraryItemSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(ITINERARY_KINDS),
  title: z.string().min(1).max(300),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  /** Estimated visit length in minutes. Always an estimate, never observed. */
  estimatedDurationMinutes: z.number().int().positive().max(720).optional(),
  place: z
    .object({
      name: z.string().min(1).max(300),
      address: z.string().max(500).optional(),
      rating: z.number().optional(),
      gps: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
        })
        .optional(),
    })
    .optional(),
  evidence: z.array(evidenceSchema),
  cost: costLineSchema.optional(),
  notes: z.string().max(1000).optional(),
});

export type ItineraryItem = z.infer<typeof itineraryItemSchema>;

export const tripDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  /** Absent in flexible-date mode (planned as Day 1..N). */
  date: z.string().optional(),
  items: z.array(itineraryItemSchema),
  dayCost: costBreakdownSchema,
});

export type TripDay = z.infer<typeof tripDaySchema>;

export const tripStaySchema = z.object({
  hotelName: z.string().min(1).max(300),
  nights: z.number().int().min(0),
  nightlyLowest: z.string().optional(),
  total: costLineSchema.optional(),
  evidence: evidenceSchema,
});

export type TripStay = z.infer<typeof tripStaySchema>;

export const BUDGET_VERDICTS = [
  "within",
  "exceeds_live_costs",
  "unknown",
] as const;

export const tripPlanSchema = z.object({
  destination: z.string().min(1).max(200),
  dateMode: z.enum(["fixed", "flexible"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.number().int().min(1),
  party: z.object({
    adults: z.number().int().min(1),
    children: z.number().int().min(0),
  }),
  budget: z
    .object({
      amount: z.number().positive(),
      currency: z.string().length(3),
    })
    .optional(),
  budgetVerdict: z.enum(BUDGET_VERDICTS),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  stay: tripStaySchema.optional(),
  days: z.array(tripDaySchema),
  totals: costBreakdownSchema,
  /** False when hotel prices could not be verified (e.g. flexible dates). */
  pricesVerified: z.boolean(),
});

export type TripPlan = z.infer<typeof tripPlanSchema>;
