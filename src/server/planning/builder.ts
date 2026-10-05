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
import { scorePlace } from "./scoring";

/**
 * Phase 4 Step 2 deterministic itinerary builder.
 *
 * PURE function: no network, no fetch, no client, no environment access.
 * Assembles a TripPlan from validated requirements + normalized research
 * candidates. Never invents places, prices, or facts. Ordering is guided
 * by score, category diversity, and weak slot-suitability signals — never
 * presented as route optimization.
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
  destinationContext?: {
    summary: string[];
    sources: Array<{ title: string; link: string }>;
  };
  hotelsQuery?: string;
  /**
   * Resolves the research query that produced a place (for evidence).
   * Absent in unit tests — evidence query is then omitted.
   */
  queryForPlace?: (place: NormalizedMapsPlace) => string | undefined;
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

/** Weak slot-suitability signals: outdoor/view places prefer mornings. */
const OUTDOOR_RE = /fort|palace|viewpoint|lake|garden|park|tower|sunset/i;
const INDOOR_RE = /museum|gallery|market|mall|bazaar/i;

function placeText(place: NormalizedMapsPlace): string {
  return `${place.title ?? ""} ${place.placeType ?? ""} ${(place.placeTypes ?? []).join(" ")}`;
}

function estimateDuration(place: NormalizedMapsPlace): number {
  const text = placeText(place);
  for (const { test, minutes } of DURATION_KEYWORDS) {
    if (test.test(text)) return minutes;
  }
  return DEFAULT_DURATION_MINUTES;
}

/** +1 outdoor, -1 indoor/market, 0 unknown — a preference, not a fact. */
function morningSuitability(place: NormalizedMapsPlace): number {
  const text = placeText(place);
  if (OUTDOOR_RE.test(text) && !INDOOR_RE.test(text)) return 1;
  if (INDOOR_RE.test(text) && !OUTDOOR_RE.test(text)) return -1;
  return 0;
}

function primaryType(place: NormalizedMapsPlace): string {
  return (place.placeType ?? place.placeTypes?.[0] ?? "").toLowerCase();
}

function mapsEvidence(
  place: NormalizedMapsPlace,
  observedAt: string,
  purpose: "attraction" | "meal",
  query?: string,
): Evidence {
  return {
    engine: "google_maps",
    observedAt,
    placeId: place.placeId,
    sourceUrl:
      place.links && typeof place.links.website === "string"
        ? place.links.website
        : undefined,
    query,
    purpose,
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

interface ScheduledPick {
  place: NormalizedMapsPlace;
  reasons: string[];
  diversityFallback: boolean;
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
          query: input.hotelsQuery,
          purpose: "stay_selection",
          currency,
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

  // ---- Scored selection with per-day category diversity ----
  const usable = input.attractions.filter(
    (p) => p.title && p.title.trim().length > 0,
  );
  const slotsPerDay = TIMED_SLOTS_PER_PACE[requirements.pace];
  const capacity = dayCount * slotsPerDay;

  const scheduledKeys = new Set<string>();
  const keyOf = (p: NormalizedMapsPlace, i: number) =>
    p.placeId ?? p.title ?? `index:${i}`;
  const dayPicks: ScheduledPick[][] = Array.from(
    { length: dayCount },
    () => [],
  );
  const remaining = usable.map((place, index) => ({ place, index }));
  let diversityFallback = false;

  outer: for (let round = 0; round < slotsPerDay; round += 1) {
    for (let day = 0; day < dayCount; day += 1) {
      if (remaining.length === 0) break outer;
      const typesToday = new Set(
        dayPicks[day]?.map((s) => primaryType(s.place)) ?? [],
      );
      const scored = remaining.map(({ place, index }) => ({
        place,
        index,
        scored: scorePlace(place, index, {
          interests: requirements.interests,
          scheduledTypesToday: typesToday,
          scheduledKeys,
        }),
      }));
      scored.sort((a, b) => b.scored.score - a.scored.score || a.index - b.index);
      const best = scored[0];
      if (!best) break outer;
      if (
        best.scored.reasons.includes("same category already scheduled today")
      ) {
        diversityFallback = true;
      }
      scheduledKeys.add(keyOf(best.place, best.index));
      dayPicks[day]?.push({
        place: best.place,
        reasons: best.scored.reasons,
        diversityFallback: best.scored.reasons.includes(
          "same category already scheduled today",
        ),
      });
      remaining.splice(
        remaining.findIndex((r) => r.index === best.index),
        1,
      );
    }
  }

  const scheduledCount = dayPicks.reduce((n, d) => n + (d?.length ?? 0), 0);
  if (scheduledCount < capacity) {
    warnings.push(
      `Only ${scheduledCount} rated place(s) were found for ${capacity} planned slot(s); ` +
        `days are shorter rather than filled with unverified options.`,
    );
  }
  if (diversityFallback) {
    warnings.push(
      "Limited variety on at least one day: the same place category appears twice because alternatives were unavailable.",
    );
  }

  // Interest coverage: warn only for explicitly requested interests with no match.
  // Food is covered by live restaurant lunch picks, not attraction slots.
  for (const interest of requirements.interests) {
    if (interest === "food" && input.food.length > 0) continue;
    const matched = dayPicks.some((day) =>
      day?.some((s) => s.reasons.some((r) => r.includes(interest))),
    );
    if (!matched && scheduledCount > 0) {
      warnings.push(
        `No highly-rated options found for the "${interest}" interest; days lean on other interests.`,
      );
    }
  }

  // Opening-hours availability.
  const timedPlaces = dayPicks.flatMap((d) => d ?? []).map((s) => s.place);
  if (
    timedPlaces.length > 0 &&
    timedPlaces.filter((p) => !p.hours && !p.openState).length * 2 >
      timedPlaces.length
  ) {
    warnings.push(
      "Opening hours are unavailable for some scheduled places; verify before visiting.",
    );
  }

  // ---- Day assembly ----
  const queryForPlace = input.queryForPlace;
  const days: TripDay[] = [];
  for (let day = 1; day <= dayCount; day += 1) {
    const picks = [...(dayPicks[day - 1] ?? [])];
    // Suitability ordering: outdoor-leaning places take earlier slots.
    // Stable for ties, so score order wins among equals.
    picks.sort(
      (a, b) => morningSuitability(b.place) - morningSuitability(a.place),
    );

    const items: ItineraryItem[] = [];
    picks.forEach((pick, slot) => {
      const window = TIME_WINDOWS[slot];
      if (!window) return;
      const reasons = [...pick.reasons];
      const suitability = morningSuitability(pick.place);
      if (suitability > 0 && slot === 0) {
        reasons.push("morning slot for an outdoor visit");
      } else if (suitability < 0 && slot > 0) {
        reasons.push("afternoon slot for an indoor visit");
      }
      if (pick.diversityFallback) {
        reasons.push("limited variety: repeated category today");
      }
      items.push({
        id: `d${day}-attraction-${slot + 1}`,
        kind: "attraction",
        title: pick.place.title as string,
        startTime: window.start,
        endTime: window.end,
        estimatedDurationMinutes: estimateDuration(pick.place),
        place: {
          name: pick.place.title as string,
          address: pick.place.address,
          rating: pick.place.rating,
          ...(pick.place.gpsCoordinates
            ? {
                gps: {
                  latitude: pick.place.gpsCoordinates.latitude,
                  longitude: pick.place.gpsCoordinates.longitude,
                },
              }
            : {}),
        },
        evidence: [
          mapsEvidence(
            pick.place,
            observedAt,
            "attraction",
            queryForPlace?.(pick.place),
          ),
        ],
        selectionReasons: reasons.slice(0, 6),
        notes: pick.place.openState
          ? `Reported status: ${pick.place.openState}.`
          : undefined,
      });
    });

    // Lunch cycles deterministically through live restaurant picks.
    const lunchPick =
      input.food.length > 0
        ? input.food[(day - 1) % input.food.length]
        : undefined;
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
        evidence: [
          mapsEvidence(
            lunchPick,
            observedAt,
            "meal",
            queryForPlace?.(lunchPick),
          ),
        ],
        selectionReasons: ["live restaurant candidate"],
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
    ...(input.destinationContext ? { destinationContext: input.destinationContext } : {}),
  };
}
