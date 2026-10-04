import { ValidationError } from "../../lib/errors";
import { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedHotel,
  NormalizedMapsPlace,
  NormalizedSearchResultItem,
} from "../services/serpapi/types";
import type { IntentName, TravelIntent } from "./intent";

/**
 * Phase 3 server-side responder/executor.
 *
 * Receives a validated TravelIntent, dispatches to exactly one existing
 * SerpApiClient method, and shapes a GhoomAIResponse from NORMALIZED
 * results only. Contains no intent-classification logic and no HTTP logic.
 */

export type GhoomAIEngine = "google" | "google_maps" | "google_hotels";

export type GhoomAIResultItem =
  | NormalizedSearchResultItem
  | NormalizedMapsPlace
  | NormalizedHotel;

export interface GhoomAIResponse {
  intent: IntentName;
  engine: GhoomAIEngine;
  message: string;
  destination?: string;
  resultCount: number;
  results: GhoomAIResultItem[];
  dates?: {
    checkIn: string;
    checkOut: string;
    source: "user" | "default";
    currency: string;
  };
}

function describeDestination(destination?: string): string {
  return destination ? ` in ${destination}` : "";
}

function noResultsMessage(kind: string, destination?: string): string {
  return (
    `No ${kind} found${describeDestination(destination)} for this request. ` +
    `Try a different destination or wording — every result below would come ` +
    `from live travel data, so nothing is shown rather than guessed.`
  );
}

/**
 * Executes a validated intent against live SerpApi data.
 * The client is injectable for tests; production callers omit it.
 */
export async function executeIntent(
  intent: TravelIntent,
  client: SerpApiClient = new SerpApiClient(),
): Promise<GhoomAIResponse> {
  switch (intent.intent) {
    case "find_hotels": {
      if (!intent.checkIn || !intent.checkOut) {
        throw new ValidationError("Hotel intent requires stay dates.");
      }
      const data = await client.searchHotels({
        query: intent.query,
        checkIn: intent.checkIn,
        checkOut: intent.checkOut,
        adults: intent.adults ?? 2,
        children: intent.children,
        childrenAges: intent.childrenAges,
        currency: "INR",
      });
      const dateNote =
        intent.datesSource === "default"
          ? " (default dates — provide check-in/check-out for exact pricing)"
          : "";
      return {
        intent: intent.intent,
        engine: "google_hotels",
        message:
          data.resultCount > 0
            ? `Found ${data.resultCount} stay options${describeDestination(intent.destination)} ` +
              `(${data.checkIn} → ${data.checkOut})${dateNote}. ` +
              `Prices and ratings are live from Google Hotels.`
            : noResultsMessage("stay options", intent.destination),
        destination: intent.destination,
        resultCount: data.resultCount,
        results: data.results,
        dates: {
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          source: intent.datesSource ?? "default",
          currency: data.currency,
        },
      };
    }

    case "discover_places": {
      const data = await client.searchMaps({
        query: intent.query,
        location: intent.destination,
      });
      return {
        intent: intent.intent,
        engine: "google_maps",
        message:
          data.resultCount > 0
            ? `Found ${data.resultCount} places${describeDestination(intent.destination)}. ` +
              `Ratings, addresses, and hours are live from Google Maps.`
            : noResultsMessage("places", intent.destination),
        destination: intent.destination,
        resultCount: data.resultCount,
        results: data.results,
      };
    }

    case "general_search": {
      const data = await client.search({
        engine: "google",
        query: intent.query,
        num: 8,
      });
      return {
        intent: intent.intent,
        engine: "google",
        message:
          data.resultCount > 0
            ? `Found ${data.resultCount} results${describeDestination(intent.destination)}. ` +
              `These are live from Google Search.`
            : noResultsMessage("results", intent.destination),
        destination: intent.destination,
        resultCount: data.resultCount,
        results: data.results,
      };
    }

    default: {
      throw new ValidationError("Unsupported intent.");
    }
  }
}
