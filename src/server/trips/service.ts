import { ValidationError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import { researchDestination } from "../research/destination";
import { researchHotels } from "../research/hotels";
import { researchPlaces } from "../research/places";
import { buildTripPlan } from "../planning/builder";
import {
  resolveRequirements,
  tripPlanRequestSchema,
  type TripPlanRequest,
} from "./requirements";
import type { TripPlan } from "./plan";

/**
 * Phase 4 Step 1 trip service: validates requirements, researches live
 * SerpApi data, and assembles the TripPlan via the pure builder.
 * Orchestration only — no planning algorithm, no HTTP, no UI.
 */

export type PlanTripResult =
  | { status: "ready"; plan: TripPlan }
  | { status: "needs_input"; missing: string[]; message: string };

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Default hotel-research window for flexible-date trips (unverified prices). */
function defaultStayWindow(now: Date): { checkIn: string; checkOut: string } {
  const base = now.getTime();
  return {
    checkIn: toIsoDate(new Date(base + 30 * 86_400_000)),
    checkOut: toIsoDate(new Date(base + 33 * 86_400_000)),
  };
}

export async function planTrip(
  input: unknown,
  client: SerpApiClient = new SerpApiClient(),
  now: Date = new Date(),
): Promise<PlanTripResult> {
  const parsed = tripPlanRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid trip request.");
  }
  const request: TripPlanRequest = parsed.data;

  const resolution = resolveRequirements(request, now);
  if (resolution.status === "needs_input") {
    return resolution;
  }
  const { requirements, assumptions } = resolution;
  const currency = requirements.budget?.currency ?? "INR";
  const observedAt = now.toISOString();

  const stayWindow =
    requirements.dateMode === "fixed" &&
    requirements.startDate &&
    requirements.endDate
      ? {
          checkIn: requirements.startDate,
          checkOut: requirements.endDate,
          verified: true,
        }
      : { ...defaultStayWindow(now), verified: false };

  // Research in parallel; either side may fail independently.
  const [hotelsSettled, placesSettled] = await Promise.allSettled([
    researchHotels(client, requirements, stayWindow, currency),
    researchPlaces(client, requirements),
  ]);

  const researchWarnings: string[] = [];
  if (hotelsSettled.status === "rejected") {
    researchWarnings.push(
      "Accommodation research failed; the plan has no stay section.",
    );
  }
  if (placesSettled.status === "rejected") {
    researchWarnings.push(
      "Attraction research failed; days contain no timed activities.",
    );
  }
  if (
    hotelsSettled.status === "rejected" &&
    placesSettled.status === "rejected"
  ) {
    throw hotelsSettled.reason instanceof Error
      ? hotelsSettled.reason
      : new Error("Trip research failed.");
  }

  const hotels =
    hotelsSettled.status === "fulfilled" ? hotelsSettled.value.hotels : [];
  const hotelsQuery =
    hotelsSettled.status === "fulfilled" ? hotelsSettled.value.query : undefined;
  const placePools =
    placesSettled.status === "fulfilled"
      ? placesSettled.value
      : {
          attractions: [],
          food: [],
          interestExtra: [],
          queries: { attractions: "" },
        };
  const places = [...placePools.attractions, ...placePools.interestExtra];
  const food = placePools.food;

  // Destination context is conditional: thin pools or broad interests only.
  // Its failure never destroys an otherwise valid plan.
  const usableCount = places.filter(
    (p) => p.title && p.title.trim().length > 0,
  ).length;
  const wantsContext =
    usableCount < 4 || requirements.interests.length >= 3;
  let destinationContext:
    | { summary: string[]; sources: Array<{ title: string; link: string }> }
    | undefined;
  if (wantsContext) {
    try {
      const ctx = await researchDestination(client, requirements.destination);
      destinationContext = { summary: ctx.summary, sources: ctx.sources };
    } catch {
      researchWarnings.push(
        "Destination background research failed; the plan has no destination summary.",
      );
    }
  }

  // Evidence query origins, by object identity within this request.
  const origin = new Map<NormalizedMapsPlace, string>();
  if (placesSettled.status === "fulfilled") {
    const { attractions, food: foodPool, interestExtra, queries } = placePools;
    for (const p of attractions) origin.set(p, queries.attractions);
    if (queries.food) for (const p of foodPool) origin.set(p, queries.food);
    if (queries.interest) for (const p of interestExtra) origin.set(p, queries.interest);
  }

  const plan = buildTripPlan({
    requirements,
    assumptions,
    hotels,
    attractions: places,
    food,
    currency,
    stayWindow,
    observedAt,
    researchWarnings,
    destinationContext,
    hotelsQuery,
    queryForPlace: (place) => origin.get(place),
  });

  return { status: "ready", plan };
}
