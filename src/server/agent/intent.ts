import { z } from "zod";
import { ValidationError } from "../../lib/errors";
import { parseIsoCalendarDate } from "../services/serpapi/types";

/**
 * Phase 3 deterministic intent layer.
 *
 * Pure functions only: no network, no secrets, no LLM calls.
 * `resolveIntent()` maps a user message (+ optional hints) to a validated
 * TravelIntent. A future LLM-based classifier can replace the keyword router
 * as long as it returns the same TravelIntent shape.
 */

export const INTENT_NAMES = [
  "find_hotels",
  "discover_places",
  "general_search",
] as const;

export type IntentName = (typeof INTENT_NAMES)[number];

export const RESPONSE_MODES = ["cards"] as const;

export const travelIntentSchema = z.object({
  intent: z.enum(INTENT_NAMES),
  destination: z.string().min(1).max(200).optional(),
  query: z.string().min(1).max(300),
  engine: z.enum(["google", "google_maps", "google_hotels"]),
  responseMode: z.enum(RESPONSE_MODES).default("cards"),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  adults: z.number().int().min(1).max(16).optional(),
  children: z.number().int().min(0).max(10).optional(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
  datesSource: z.enum(["user", "default"]).optional(),
});

export type TravelIntent = z.infer<typeof travelIntentSchema>;

/** Optional caller hints. Never carries secrets or engine overrides. */
export const askContextSchema = z.object({
  destination: z.string().min(1).max(200).optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  adults: z.number().int().min(1).max(16).optional(),
  children: z.number().int().min(0).max(10).optional(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
});

export type AskContext = z.infer<typeof askContextSchema>;

export const MAX_MESSAGE_LENGTH = 500;

const HOTEL_KEYWORDS = [
  "hotel",
  "hotels",
  "stay",
  "stays",
  "staying",
  "room",
  "rooms",
  "check-in",
  "check in",
  "accommodation",
  "resort",
  "resorts",
  "hostel",
  "hostels",
  "guesthouse",
  "villa",
];

const PLACE_KEYWORDS = [
  "visit",
  "visiting",
  "see",
  "places",
  "attractions",
  "attraction",
  "tourist",
  "things to do",
  "sightseeing",
  "landmark",
  "landmarks",
  "explore",
  "exploring",
];

function containsKeyword(lower: string, keywords: string[]): boolean {
  return keywords.some((k) => lower.includes(k));
}

const MAX_DESTINATION_WORDS = 4;
const MAX_DESTINATION_LENGTH = 60;

/**
 * Takes the leading capitalized words of a captured phrase, cutting at the
 * first lowercase word. Returns undefined when nothing confident remains.
 */
function takeCapitalizedPhrase(capture: string | undefined): string | undefined {
  if (!capture) return undefined;
  const parts: string[] = [];
  for (const word of capture.trim().split(/\s+/)) {
    if (parts.length >= MAX_DESTINATION_WORDS) break;
    if (/^[A-Z]/.test(word)) {
      parts.push(word.replace(/[.,;!?]+$/, ""));
    } else {
      break;
    }
  }
  if (parts.length === 0) return undefined;
  const name = parts.join(" ");
  if (name.length < 2 || name.length > MAX_DESTINATION_LENGTH) return undefined;
  return name;
}

/**
 * Deliberately narrow destination extraction: a capitalized phrase after
 * in/at/near/for/to (or directly after "plan"), cut at the first lowercase
 * word. Scans preposition positions in order and returns the first confident
 * phrase, so an early non-place phrase ("for 2 adults", "to spend", "to
 * visit") never shadows a real destination later in the message. Returns
 * undefined when no confident destination is found — the caller must not
 * invent one.
 */
export function extractDestination(message: string): string | undefined {
  const normalized = message.replace(/\s+/g, " ").trim();
  const prepositions = /\b(?:in|at|near|for|to)\b/g;
  for (const preposition of normalized.matchAll(prepositions)) {
    const rest = normalized.slice(
      (preposition.index ?? 0) + preposition[0].length,
    );
    const capture = rest.match(/^\s+([A-Za-z][A-Za-z\s\-']{0,80})/);
    const name = takeCapitalizedPhrase(capture?.[1]);
    if (name) return name;
  }
  // Fallback for direct phrasing with no preposition ("plan Jaipur ..."):
  // a capitalized phrase immediately after "plan".
  const barePlan = normalized.match(/\bplan\b\s+([A-Z][A-Za-z\s\-']{0,40})/);
  const fallback = takeCapitalizedPhrase(barePlan?.[1]);
  if (fallback) return fallback;
  return undefined;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dynamic default stay window: server date +30 / +33 days. */
function defaultStayWindow(now: Date): { checkIn: string; checkOut: string } {
  const inMs = now.getTime();
  return {
    checkIn: toIsoDate(new Date(inMs + 30 * 86_400_000)),
    checkOut: toIsoDate(new Date(inMs + 33 * 86_400_000)),
  };
}

interface StayDates {
  checkIn: string;
  checkOut: string;
  datesSource: "user" | "default";
}

/**
 * Uses caller dates only when both are valid calendar dates with
 * checkout strictly after check-in; otherwise falls back to the
 * dynamic default window. Never returns invalid dates.
 */
function resolveStayDates(context: AskContext, now: Date): StayDates {
  if (context.checkIn && context.checkOut) {
    const ci = parseIsoCalendarDate(context.checkIn);
    const co = parseIsoCalendarDate(context.checkOut);
    if (ci && co) {
      const inMs = Date.UTC(ci.y, ci.m - 1, ci.d);
      const outMs = Date.UTC(co.y, co.m - 1, co.d);
      if (outMs > inMs) {
        return {
          checkIn: context.checkIn,
          checkOut: context.checkOut,
          datesSource: "user",
        };
      }
    }
  }
  const defaults = defaultStayWindow(now);
  return { ...defaults, datesSource: "default" };
}

/**
 * Deterministic intent router. Pure: same inputs always yield the same
 * intent, and it never performs I/O. Throws ValidationError on empty or
 * over-long messages.
 */
export function resolveIntent(
  message: string,
  context: AskContext = {},
  now: Date = new Date(),
): TravelIntent {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new ValidationError("Message must be non-empty.");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(
      `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }
  const lower = trimmed.toLowerCase();
  const fallbackQuery = trimmed.slice(0, 300);
  const hintedDestination = context.destination?.trim() || undefined;

  if (containsKeyword(lower, HOTEL_KEYWORDS)) {
    const destination = hintedDestination ?? extractDestination(trimmed);
    const dates = resolveStayDates(context, now);
    return travelIntentSchema.parse({
      intent: "find_hotels",
      destination,
      query: destination ? `hotels in ${destination}` : fallbackQuery,
      engine: "google_hotels",
      responseMode: "cards",
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      adults: context.adults,
      children: context.children,
      childrenAges: context.childrenAges,
      datesSource: dates.datesSource,
    });
  }

  if (containsKeyword(lower, PLACE_KEYWORDS)) {
    const destination = hintedDestination ?? extractDestination(trimmed);
    return travelIntentSchema.parse({
      intent: "discover_places",
      destination,
      query: destination
        ? `tourist attractions in ${destination}`
        : fallbackQuery,
      engine: "google_maps",
      responseMode: "cards",
    });
  }

  return travelIntentSchema.parse({
    intent: "general_search",
    destination: hintedDestination ?? extractDestination(trimmed),
    query: fallbackQuery,
    engine: "google",
    responseMode: "cards",
  });
}
