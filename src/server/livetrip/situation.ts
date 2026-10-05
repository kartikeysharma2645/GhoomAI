import { z } from "zod";

/**
 * Phase 7 Step 1 live situation check contracts.
 *
 * A live situation check observes an ACTIVE trip against FRESH provider
 * data and reports what changed — it never modifies the itinerary.
 * Detection is conservative: ambiguous or missing evidence yields
 * ATTENTION or UNVERIFIED, never DISRUPTION. Only a stable-ID-matched
 * Maps closure/open-state contradiction produces DISRUPTION.
 */

export const SITUATION_STATUSES = [
  "CLEAR",
  "ATTENTION",
  "DISRUPTION",
  "UNVERIFIED",
] as const;

export type SituationStatus = (typeof SITUATION_STATUSES)[number];

export const SITUATION_TYPES = [
  "CLOSED",
  "TEMPORARILY_CLOSED",
  "SCHEDULE_CHANGE",
  "WEATHER",
  "EVENT_DISRUPTION",
  "GENERAL_TRAVEL_DISRUPTION",
  "UNKNOWN",
] as const;

export type SituationType = (typeof SITUATION_TYPES)[number];

export const SITUATION_SEVERITIES = ["low", "medium", "high"] as const;
export type SituationSeverity = (typeof SITUATION_SEVERITIES)[number];

export const SITUATION_CONFIDENCES = ["low", "medium", "high"] as const;
export type SituationConfidence = (typeof SITUATION_CONFIDENCES)[number];

export const RECOMMENDED_ACTIONS = [
  "none",
  "monitor",
  "review",
  "replace",
] as const;

export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const situationEvidenceSchema = z.object({
  engine: z.enum(["google", "google_maps", "google_hotels"]),
  query: z.string().min(1).max(300),
  observedAt: z.string(),
  sourceUrl: z.string().optional(),
  facts: z.object({
    openState: z.string().optional(),
    rating: z.number().optional(),
    title: z.string().optional(),
    snippet: z.string().optional(),
  }),
});

export type SituationEvidence = z.infer<typeof situationEvidenceSchema>;

export const detectedSituationSchema = z.object({
  situationId: z.string().min(1).max(200),
  type: z.enum(SITUATION_TYPES),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(1000),
  severity: z.enum(SITUATION_SEVERITIES),
  confidence: z.enum(SITUATION_CONFIDENCES),
  evidence: situationEvidenceSchema,
  affectedItemIds: z.array(z.string().min(1).max(100)),
  recommendedAction: z.enum(RECOMMENDED_ACTIONS),
});

export type DetectedSituation = z.infer<typeof detectedSituationSchema>;

export const liveSituationResultSchema = z.object({
  checkedAt: z.string(),
  destination: z.string().min(1).max(200),
  status: z.enum(SITUATION_STATUSES),
  situations: z.array(detectedSituationSchema),
  checkedItemIds: z.array(z.string()),
  affectedItemIds: z.array(z.string()),
  queriesUsed: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type LiveSituationResult = z.infer<typeof liveSituationResultSchema>;

/** Max itinerary items examined per live check (quota-conscious). */
export const MAX_LIVE_ITEMS = 6;

/** Destination-level search queries per live check. */
export const DESTINATION_QUERIES = [
  "{destination} travel disruption",
  "{destination} major road closure today",
] as const;

export const MAX_DESTINATION_QUERIES = 2;

/** Place query used when an item carries no usable research query. */
export function fallbackPlaceQuery(title: string, destination: string): string {
  return `${title} ${destination}`.slice(0, 300);
}

export function renderDestinationQuery(
  template: string,
  destination: string,
): string {
  return template.replace("{destination}", destination).slice(0, 300);
}

/**
 * Deterministic situation ID: stable across identical inputs so repeated
 * checks of the same finding correlate without a database.
 */
export function situationId(
  type: string,
  key: string,
  query: string,
): string {
  const norm = `${type}:${key}:${query}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return norm || "situation";
}

export interface LiveCheckCandidate {
  itemId: string;
  kind: string;
  title: string;
  dayNumber: number;
  placeName?: string;
  placeId?: string;
  query: string;
  plannedOpenState?: string;
}

/**
 * Deterministic candidate selection from an ActiveTrip snapshot.
 * Skips COMPLETED/SKIPPED entries and generic notes; prioritizes the
 * current day first, then later days in order; caps the total.
 * Pure and unit-testable — no network, no clock.
 */
export function selectLiveCheckCandidates(input: {
  destination: string;
  currentDayNumber: number;
  days: Array<{
    dayNumber: number;
    items: Array<{
      id: string;
      kind: string;
      title: string;
      place?: { name: string };
      evidence: Array<{ query?: string; placeId?: string; facts?: { openState?: string } }>;
    }>;
  }>;
  progress: Array<{
    dayNumber: number;
    items: Array<{ itemId: string; status: string }>;
  }>;
}): LiveCheckCandidate[] {
  const statusOf = new Map<string, string>();
  for (const day of input.progress) {
    for (const entry of day.items) {
      statusOf.set(`${day.dayNumber}:${entry.itemId}`, entry.status);
    }
  }
  const orderedDays = [...input.days].sort((a, b) => {
    const rank = (d: number) =>
      d === input.currentDayNumber ? 0 : d > input.currentDayNumber ? 1 : 2;
    return rank(a.dayNumber) - rank(b.dayNumber) || a.dayNumber - b.dayNumber;
  });
  const candidates: LiveCheckCandidate[] = [];
  for (const day of orderedDays) {
    if (day.dayNumber < input.currentDayNumber) continue;
    for (const item of day.items) {
      if (candidates.length >= MAX_LIVE_ITEMS) break;
      if (item.kind === "note") continue;
      const status = statusOf.get(`${day.dayNumber}:${item.id}`);
      if (status !== "UPCOMING" && status !== "IN_PROGRESS") continue;
      const storedQuery = item.evidence[0]?.query?.trim();
      candidates.push({
        itemId: item.id,
        kind: item.kind,
        title: item.title,
        dayNumber: day.dayNumber,
        placeName: item.place?.name,
        placeId: item.evidence[0]?.placeId,
        query: storedQuery || fallbackPlaceQuery(item.title, input.destination),
        plannedOpenState: item.evidence[0]?.facts?.openState,
      });
    }
    if (candidates.length >= MAX_LIVE_ITEMS) break;
  }
  return candidates;
}
