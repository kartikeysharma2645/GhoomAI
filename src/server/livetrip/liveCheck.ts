import { ConflictError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type { NormalizedMapsPlace } from "../services/serpapi/types";
import { activeTripSchema, type ActiveTrip } from "./activeTrip";
import {
  compareOpenState,
  detectsClosure,
} from "../realitycheck/compare";
import { matchPlace } from "../realitycheck/queries";
import {
  DESTINATION_QUERIES,
  liveSituationResultSchema,
  MAX_DESTINATION_QUERIES,
  renderDestinationQuery,
  selectLiveCheckCandidates,
  situationId,
  type DetectedSituation,
  type LiveCheckCandidate,
  type LiveSituationResult,
  type SituationStatus,
} from "./situation";

/**
 * Phase 7 Step 1 live situation check.
 *
 * Observes an ACTIVE trip against FRESH provider data and reports what
 * changed. Orchestration only: selects bounded candidates, fans out
 * gateway calls with per-query isolation, and classifies conservatively.
 * Never mutates the trip. Never reschedules — detection only.
 */

const WEATHER_RE =
  /storm|flood|heavy rain|cyclone|hurricane|heatwave|blizzard|landslide|torrential/i;
const DISRUPTION_RE =
  /road clos|street clos|strike|protest|curfew|travel advis|warning|disruption|cancelled|shut down/i;
const EVENT_RE = /festival|marathon|rally|summit|mela|fair|event/i;

function classifySearchHit(
  title: string,
  snippet: string,
): { type: "WEATHER" | "GENERAL_TRAVEL_DISRUPTION" | "EVENT_DISRUPTION"; label: string } | null {
  const text = `${title} ${snippet}`;
  if (WEATHER_RE.test(text)) return { type: "WEATHER", label: "weather" };
  if (DISRUPTION_RE.test(text)) {
    return { type: "GENERAL_TRAVEL_DISRUPTION", label: "travel disruption" };
  }
  if (EVENT_RE.test(text)) {
    return { type: "EVENT_DISRUPTION", label: "large event" };
  }
  return null;
}

export async function checkLiveSituation(
  input: unknown,
  client: SerpApiClient = new SerpApiClient(),
  now: Date = new Date(),
): Promise<LiveSituationResult> {
  const parsed = activeTripSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConflictError("Invalid ActiveTrip snapshot.");
  }
  const trip: ActiveTrip = parsed.data;
  if (trip.status !== "ACTIVE") {
    throw new ConflictError(
      `Trip is ${trip.status}; live checks require an ACTIVE trip.`,
    );
  }
  const checkedAt = now.toISOString();
  const destination = trip.plan.destination;
  const warnings: string[] = [];

  const candidates = selectLiveCheckCandidates({
    destination,
    currentDayNumber: trip.currentDayNumber,
    days: trip.plan.days,
    progress: trip.progress,
  });

  // Batch identical place queries: one live call per distinct query.
  const queryGroups = new Map<string, LiveCheckCandidate[]>();
  for (const candidate of candidates) {
    const group = queryGroups.get(candidate.query);
    if (group) group.push(candidate);
    else queryGroups.set(candidate.query, [candidate]);
  }
  const placeResults = new Map<string, NormalizedMapsPlace[] | Error>();
  await Promise.all(
    [...queryGroups.keys()].map(async (query) => {
      try {
        const res = await client.searchMaps({ query, location: destination });
        placeResults.set(query, res.results);
      } catch (err) {
        placeResults.set(
          query,
          err instanceof Error ? err : new Error("Live place research failed."),
        );
      }
    }),
  );

  const situations: DetectedSituation[] = [];
  const checkedItemIds: string[] = [];

  for (const candidate of candidates) {
    const results = placeResults.get(candidate.query);
    if (results instanceof Error || !results) {
      warnings.push(
        `Live place research failed for "${candidate.title}"; it was not checked.`,
      );
      continue;
    }
    const match = matchPlace(
      results,
      { placeId: candidate.placeId },
      candidate.placeName ?? candidate.title,
    );
    if (!match.matched) continue;
    checkedItemIds.push(candidate.itemId);
    const fresh = match.place;
    if (detectsClosure(fresh.openState)) {
      situations.push({
        situationId: situationId(
          "CLOSED",
          fresh.placeId ?? candidate.title,
          candidate.query,
        ),
        type: "CLOSED",
        title: `${candidate.title} is reported closed`,
        description: `Live Maps data reports "${candidate.title}" as permanently closed. This itinerary item cannot reasonably be followed as planned.`,
        severity: "high",
        confidence: fresh.placeId ? "high" : "medium",
        evidence: {
          engine: "google_maps",
          query: candidate.query,
          observedAt: checkedAt,
          sourceUrl:
            fresh.links && typeof fresh.links.website === "string"
              ? fresh.links.website
              : undefined,
          facts: { openState: fresh.openState, title: fresh.title },
        },
        affectedItemIds: [candidate.itemId],
        recommendedAction: "replace",
      });
      continue;
    }
    const openCheck = compareOpenState(
      candidate.plannedOpenState,
      fresh.openState,
    );
    if (openCheck.outcome === "changed" && fresh.openState) {
      const temporarilyClosed = /closed/i.test(fresh.openState);
      situations.push({
        situationId: situationId(
          temporarilyClosed ? "TEMPORARILY_CLOSED" : "SCHEDULE_CHANGE",
          fresh.placeId ?? candidate.title,
          candidate.query,
        ),
        type: temporarilyClosed ? "TEMPORARILY_CLOSED" : "SCHEDULE_CHANGE",
        title: `${candidate.title} shows changed hours or status`,
        description: `Live Maps data reports status "${fresh.openState}" for "${candidate.title}". Review before visiting.`,
        severity: "medium",
        confidence: fresh.placeId ? "medium" : "low",
        evidence: {
          engine: "google_maps",
          query: candidate.query,
          observedAt: checkedAt,
          facts: { openState: fresh.openState, title: fresh.title },
        },
        affectedItemIds: [candidate.itemId],
        recommendedAction: "review",
      });
    }
  }

  // Destination-level disruption signals: bounded Google Search queries.
  // Search-based findings cap at ATTENTION — never DISRUPTION.
  const destinationQueries = DESTINATION_QUERIES.slice(0, MAX_DESTINATION_QUERIES).map(
    (template) => renderDestinationQuery(template, destination),
  );
  await Promise.all(
    destinationQueries.map(async (query) => {
      let results: Array<{ title?: string; snippet?: string; link?: string }>;
      try {
        const res = await client.search({ engine: "google", query, num: 5 });
        results = res.results;
      } catch {
        warnings.push(
          `Destination research failed for "${query}"; skipped.`,
        );
        return;
      }
      for (const result of results) {
        const hit = classifySearchHit(
          result.title ?? "",
          result.snippet ?? "",
        );
        if (!hit) continue;
        const affected = checkedItemIds.length > 0 ? [...checkedItemIds] : [];
        situations.push({
          situationId: situationId(
            hit.type,
            destination,
            query,
          ),
          type: hit.type,
          title: `Possible ${hit.label} affecting ${destination}`,
          description:
            `A live result mentions a possible ${hit.label} relevant to ${destination} ` +
            `("${result.title ?? "untitled"}"). Treat as a watch signal, not a confirmed disruption.`,
          severity: "medium",
          confidence: "low",
          evidence: {
            engine: "google",
            query,
            observedAt: checkedAt,
            sourceUrl: result.link,
            facts: {
              title: result.title,
              snippet: (result.snippet ?? "").slice(0, 280),
            },
          },
          affectedItemIds: affected,
          recommendedAction: "monitor",
        });
        break;
      }
    }),
  );

  let status: SituationStatus = "UNVERIFIED";
  if (situations.some((s) => s.type === "CLOSED")) {
    status = "DISRUPTION";
  } else if (situations.length > 0) {
    status = "ATTENTION";
  } else if (checkedItemIds.length > 0) {
    status = "CLEAR";
  }
  if (candidates.length === 0) {
    warnings.push("No upcoming itinerary items qualified for a live check.");
  }

  const affectedItemIds = [...new Set(situations.flatMap((s) => s.affectedItemIds))];
  const queriesUsed = [
    ...queryGroups.keys(),
    ...destinationQueries,
  ];

  const result: LiveSituationResult = {
    checkedAt,
    destination,
    status,
    situations,
    checkedItemIds,
    affectedItemIds,
    queriesUsed,
    warnings,
  };
  return liveSituationResultSchema.parse(result);
}
