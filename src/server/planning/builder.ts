import type {
  NormalizedHotel,
  NormalizedMapsPlace,
} from "../services/serpapi/types";
import type { TripRequirements } from "../trips/requirements";
import type {
  CostBreakdown,
  CostLine,
  Evidence,
  ItineraryItem,
  TripDay,
  TripPlan,
} from "../trips/plan";

/**
 * Phase 4 Step 1 deterministic itinerary builder.
 *
 * PURE function: no network, no fetch, no client, no environment access.
 * Assembles a TripPlan from validated requirements + normalized research
 * candidates. Never invents places, prices, or facts.
 */

export interface BuilderInput {
  requirements: TripRequirements;
  assumptions: string[];
  hotels: NormalizedHotel[];
  attractions: NormalizedMapsPlace[];
  food: NormalizedMapsPlace[];
  currency: string;
  stayWindow: { checkIn: string; checkOut: string; verified: boolean };
  observedAt: string;
  researchWarnings: string[];
}

export const ROUTE_WARNING =
  "Daily activity order is not route-optimized because route distance/time data is not currently available.";

const TIMED_SLOTS_PER_PACE: Record<TripRequirements["pace"], number> = {
  relaxed: 1,
  balanced: 2,
  packed: 3,
};

const TIME_WINDOWS = [
  { start: "09:30", end: "12:00" },
  { start: "14:00", end: "16:30" },
  { start: "17:00", end: "18:30" },
];

/** Estimated visit lengths by place-type keywords, in minutes. */
const DURATION_KEYWORDS: Array<{ test: RegExp; minutes: number }> = [
  { test: /fort|palace|haveli/i, minutes: 150 },
  { test: /museum|gallery/i, minutes: 120 },
  { test: /market|bazaar|souvenir|handicraft/i, minutes: 90 },
  { test: /temple|mosque|church|shrine/i, minutes: 60 },
  { test: /lake|garden|park|viewpoint|sunset/i, minutes: 60 },
];

const DEFAULT_DURATION_MINUTES = 120;

/** Interest keyword stems matched against place title/type text. */
const INTEREST_MATCHERS: Record<string, RegExp> = {
  history: /fort|palace|museum|heritage|temple|monument|haveli|tomb/i,
  photography: /viewpoint|sunset|lake|palace|fort|garden|tower/i,
  food: /restaurant|cafe|food|cuisine|market|dhaba|eatery/i,
  nature: /park|garden|lake|zoo|sanctuary|bird/i,
  shopping: /market|bazaar|mall|souvenir|handicraft|textile/i,
  nightlife: /bar|club|night|rooftop|lounge/i,
};

function placeText(place: NormalizedMapsPlace): string {
  return `${place.title ?? ""} ${place.placeType ?? ""} ${(place.placeTypes ?? []).join(" ")}`;
}

function interestScore(
  place: NormalizedMapsPlace,
  interests: string[],
): number {
  const text = placeText(place);
  let bonus = 0;
  for (const interest of interests) {
    const matcher = INTEREST_MATCHERS[interest];
    if (matcher && matcher.test(text)) bonus += 1.5;
  }
  return (place.rating ?? 0) + bonus;
}

function estimateDuration(place: NormalizedMapsPlace): number {
  const text = placeText(place);
  for (const { test, minutes } of DURATION_KEYWORDS) {
    if (test.test(text)) return minutes;
  }
  return DEFAULT_DURATION_MINUTES;
}

function mapsEvidence(
  place: NormalizedMapsPlace,
  observedAt: string,
): Evidence {
  return {
    engine: "google_maps",
    observedAt,
    placeId: place.placeId,
    sourceUrl:
      place.links && typeof place.links.website === "string"
        ? place.links.website
        : undefined,
    facts: {
      rating: place.rating,
      reviews: place.reviews,
      address: place.address,
      hours: place.hours,
      openState: place.openState,
    },
  };
}

interface StayPick {
  hotel: NormalizedHotel;
  total: CostLine | undefined;
  warnings: string[];
}

/** Picks one anchor stay: best-rated affordable-with-price option first. */
function pickStay(
  hotels: NormalizedHotel[],
  nights: number,
  budgetAmount: number | undefined,
  currency: string,
): StayPick | undefined {
  const named = hotels.filter((h) => h.name && h.name.trim().length > 0);
  if (named.length === 0 || nights <= 0) return undefined;
  const warnings: string[] = [];

  const priced = named.filter(
    (h) => typeof h.nightlyLowestExtracted === "number",
  );
  const affordable =
    budgetAmount !== undefined
      ? priced.filter((h) => (h.nightlyLowestExtracted as number) * nights <= budgetAmount)
      : priced;

  const byRating = (a: NormalizedHotel, b: NormalizedHotel) =>
    (b.overallRating ?? 0) - (a.overallRating ?? 0) ||
    (b.reviews ?? 0) - (a.reviews ?? 0);

  let chosen: NormalizedHotel | undefined;
  if (affordable.length > 0) {
    chosen = [...affordable].sort(byRating)[0];
  } else if (priced.length > 0) {
    chosen = [...priced].sort(byRating)[0];
    if (budgetAmount !== undefined) {
      warnings.push(
        "The selected stay exceeds the stated budget at live prices.",
      );
    }
  } else {
    chosen = [...named].sort(byRating)[0];
    warnings.push(
      "No live nightly price was available for the selected stay.",
    );
  }

  let total: CostLine | undefined;
  if (typeof chosen.nightlyLowestExtracted === "number") {
    total = {
      label: `Stay: ${chosen.name} × ${nights} night${nights === 1 ? "" : "s"}`,
      amount: (chosen.nightlyLowestExtracted as number) * nights,
      currency,
      basis: "live",
    };
  }
  return { hotel: chosen, total, warnings };
}

function addDaysIso(startDate: string, offset: number): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return dt.toISOString().slice(0, 10);
}

export function buildTripPlan(input: BuilderInput): TripPlan {
  const {
    requirements,
    assumptions,
    currency,
    stayWindow,
    observedAt,
    researchWarnings,
  } = input;
  const warnings: string[] = [...researchWarnings, ROUTE_WARNING];

  const dayCount = requirements.durationDays;
  const nights = Math.max(dayCount - 1, 0);

  // ---- Stay selection ----
  let stay: TripPlan["stay"];
  let stayTotal: CostLine | undefined;
  if (nights > 0) {
    const pick = pickStay(
      input.hotels,
      nights,
      requirements.budget?.amount,
      currency,
    );
    if (pick) {
      warnings.push(...pick.warnings);
      stayTotal = pick.total;
      stay = {
        hotelName: pick.hotel.name,
        nights,
        nightlyLowest: pick.hotel.nightlyLowest,
        total: pick.total,
        evidence: {
          engine: "google_hotels",
          observedAt,
          propertyToken: pick.hotel.propertyToken,
          facts: {
            rating: pick.hotel.overallRating,
            reviews: pick.hotel.reviews,
            nightlyExtracted: pick.hotel.nightlyLowestExtracted,
            totalExtracted: pick.hotel.totalLowestExtracted,
          },
        },
      };
    } else if (input.hotels.length === 0) {
      warnings.push(
        "No accommodation candidates were found; the plan has no stay section.",
      );
    }
  }

  const pricesVerified = stayWindow.verified && stayTotal !== undefined;

  // ---- Attraction pool: prefer rated, rank by interests ----
  const usable = input.attractions.filter(
    (p) => p.title && p.title.trim().length > 0,
  );
  const preferred = usable.filter((p) => (p.rating ?? 0) >= 4.0);
  const fallback = usable.filter((p) => (p.rating ?? 0) < 4.0);
  const rank = (pool: NormalizedMapsPlace[]) =>
    [...pool].sort(
      (a, b) =>
        interestScore(b, requirements.interests) -
        interestScore(a, requirements.interests),
    );
  const ranked = [...rank(preferred), ...rank(fallback)].slice(0, 12);

  const slotsPerDay = TIMED_SLOTS_PER_PACE[requirements.pace];
  const capacity = dayCount * slotsPerDay;
  const scheduled = ranked.slice(0, capacity);
  if (scheduled.length < capacity) {
    warnings.push(
      `Only ${scheduled.length} rated place(s) were found for ${capacity} planned slot(s); ` +
        `days are shorter rather than filled with unverified options.`,
    );
  }

  // ---- Day assembly (round-robin spreads top picks across days) ----
  const days: TripDay[] = [];
  for (let day = 1; day <= dayCount; day += 1) {
    const items: ItineraryItem[] = [];
    for (let slot = 0; slot < slotsPerDay; slot += 1) {
      const place = scheduled[(day - 1) + slot * dayCount];
      if (!place) break;
      const window = TIME_WINDOWS[slot];
      items.push({
        id: `d${day}-attraction-${slot + 1}`,
        kind: "attraction",
        title: place.title as string,
        startTime: window.start,
        endTime: window.end,
        estimatedDurationMinutes: estimateDuration(place),
        place: {
          name: place.title as string,
          address: place.address,
          rating: place.rating,
          ...(place.gpsCoordinates
            ? {
                gps: {
                  latitude: place.gpsCoordinates.latitude,
                  longitude: place.gpsCoordinates.longitude,
                },
              }
            : {}),
        },
        evidence: [mapsEvidence(place, observedAt)],
        notes: place.openState ? `Reported status: ${place.openState}.` : undefined,
      });
    }

    // Lunch: reference a live restaurant pick when available, else a plain break.
    const lunchPick = input.food[day - 1] ?? input.food[0];
    if (lunchPick && lunchPick.title) {
      items.push({
        id: `d${day}-meal-1`,
        kind: "meal",
        title: `Lunch near ${lunchPick.title}`,
        startTime: "12:00",
        endTime: "14:00",
        place: {
          name: lunchPick.title,
          address: lunchPick.address,
          rating: lunchPick.rating,
        },
        evidence: [mapsEvidence(lunchPick, observedAt)],
        notes: "Pick from live restaurant options; hours vary by venue.",
      });
    } else {
      items.push({
        id: `d${day}-meal-1`,
        kind: "meal",
        title: "Lunch break",
        startTime: "12:00",
        endTime: "14:00",
        evidence: [],
        notes: "No live restaurant candidates were available for this day.",
      });
    }

    items.push({
      id: `d${day}-note-1`,
      kind: "note",
      title: "Evening at leisure",
      evidence: [],
      notes:
        "Untimed: local markets, food streets, or rest at the stay. Order within the day is not route-optimized.",
    });

    // Keep chronological order: timed items first, then meal, then note.
    const timed = items.filter((i) => i.kind === "attraction");
    const rest = items.filter((i) => i.kind !== "attraction");
    const ordered = [...timed, ...rest];

    days.push({
      dayNumber: day,
      ...(requirements.dateMode === "fixed" && requirements.startDate
        ? { date: addDaysIso(requirements.startDate, day - 1) }
        : {}),
      items: ordered,
      dayCost: { lines: [], currency },
    });
  }

  // ---- Totals & verdict ----
  const lines: CostLine[] = [];
  if (stayTotal) lines.push(stayTotal);
  const totals: CostBreakdown = { lines, currency };
  if (stayTotal?.amount !== undefined) {
    totals.liveTotal = { ...stayTotal };
  }
  let budgetVerdict: TripPlan["budgetVerdict"] = "unknown";
  if (requirements.budget) {
    if (pricesVerified && totals.liveTotal?.amount !== undefined) {
      budgetVerdict =
        totals.liveTotal.amount <= requirements.budget.amount
          ? "within"
          : "exceeds_live_costs";
    }
  }
  if (!stayWindow.verified) {
    warnings.push(
      "Hotel prices were researched with default dates, so they are not verified for exact travel dates.",
    );
  }

  return {
    destination: requirements.destination,
    dateMode: requirements.dateMode,
    ...(requirements.startDate ? { startDate: requirements.startDate } : {}),
    ...(requirements.endDate ? { endDate: requirements.endDate } : {}),
    durationDays: dayCount,
    party: { adults: requirements.adults, children: requirements.children },
    ...(requirements.budget ? { budget: requirements.budget } : {}),
    budgetVerdict,
    assumptions,
    warnings,
    ...(stay ? { stay } : {}),
    days,
    totals,
    pricesVerified,
  };
}
