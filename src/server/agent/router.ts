import { z } from "zod";
import { ValidationError } from "../../lib/errors";
import { canActivate, tripStatusSchema } from "../livetrip/lifecycle";
import {
  extractDestination,
  MAX_MESSAGE_LENGTH,
  resolveIntent,
  type TravelIntent,
} from "./intent";
import {
  conversationSessionSchema,
  type ConversationSession,
} from "./session";

/**
 * Phase 10 Prompt 1 deterministic capability router.
 *
 * Extends (never replaces) the Phase 3 keyword router: `resolveIntent`,
 * `TravelIntent`, and `/api/ask` behavior are untouched. This module adds:
 * - an extended intent taxonomy covering every Phase 1–9 capability plus
 *   explicit `needs_clarification` and `out_of_scope`;
 * - context-aware routing over a small typed `RoutingContext` (presence
 *   flags + lifecycle status, never arbitrary objects);
 * - conservative rules: a capability intent is returned only when its
 *   required context is present; otherwise a clarification naming exactly
 *   what is missing.
 *
 * No LLM, no I/O, no execution. Classification alone never performs a
 * consequential action — activation, fix/reschedule application, and
 * handoff selection execute only in Prompt 2 behind explicit confirmation.
 */

export const AGENT_INTENT_NAMES = [
  // Phase 3 search intents (unchanged semantics, delegated to resolveIntent).
  "find_hotels",
  "discover_places",
  "general_search",
  // Trip planning & verification.
  "plan_trip",
  "check_trip",
  "fix_trip",
  // Booking & handoff.
  "booking_discover",
  "booking_select",
  "booking_recheck",
  // Live Trip.
  "activate_trip",
  "trip_status",
  "trip_progress",
  "reschedule_advice",
  // Vision companion (text mention; image upload arrives with Prompt 3 UI).
  "identify_place",
  // Explicit non-action outcomes.
  "needs_clarification",
  "out_of_scope",
] as const;

export type AgentIntentName = (typeof AGENT_INTENT_NAMES)[number];

/**
 * Minimal typed routing context derived from the conversation session.
 * Presence flags only — the router never inspects plan contents, prices,
 * or transcripts, so there is nothing sensitive to leak or misread.
 */
export const routingContextSchema = z.object({
  hasActivePlan: z.boolean().default(false),
  tripStatus: tripStatusSchema.optional(),
  hasRecentCheck: z.boolean().default(false),
  hasBookingOptions: z.boolean().default(false),
  hasSelections: z.boolean().default(false),
  hasActiveTrip: z.boolean().default(false),
  destination: z.string().min(1).max(200).optional(),
});

export type RoutingContext = z.infer<typeof routingContextSchema>;

/** Caller-facing input: defaulted fields are optional for callers. */
export type RoutingContextInput = z.input<typeof routingContextSchema>;

/**
 * Derives router input from a validated conversation session.
 * Pure derivation: plan presence, lifecycle status, recent check,
 * booking options, selections, active trip, destination. Throws
 * ValidationError on malformed sessions rather than guessing context.
 */
export function contextFromSession(
  session: ConversationSession,
): RoutingContext {
  const parsed = conversationSessionSchema.safeParse(session);
  if (!parsed.success) {
    throw new ValidationError("Conversation session is invalid.");
  }
  const data = parsed.data;
  return routingContextSchema.parse({
    hasActivePlan: data.activePlan !== undefined,
    ...(data.tripStatus ? { tripStatus: data.tripStatus } : {}),
    hasRecentCheck: data.latestCheck !== undefined,
    hasBookingOptions: (data.latestDiscovery?.length ?? 0) > 0,
    hasSelections: (data.selections?.length ?? 0) > 0,
    hasActiveTrip: data.tripStatus === "ACTIVE" || data.activeTrip !== undefined,
    ...(data.activePlan ? { destination: data.activePlan.destination } : {}),
  });
}

export const agentIntentSchema = z.object({
  intent: z.enum(AGENT_INTENT_NAMES),
  /** Trimmed user message (≤300 chars), echoed for auditability. */
  query: z.string().min(1).max(300),
  destination: z.string().min(1).max(200).optional(),
  /** Set only for the three search intents (Phase 3 engine contract). */
  engine: z.enum(["google", "google_maps", "google_hotels"]).optional(),
  /** Exactly what is missing, for needs_clarification. Empty otherwise. */
  missing: z.array(z.string().max(50)).default([]),
  /** Follow-up question, set only for needs_clarification/out_of_scope. */
  clarification: z.string().max(500).optional(),
});

export type AgentIntent = z.infer<typeof agentIntentSchema>;

function has(message: string, pattern: RegExp): boolean {
  return pattern.test(message.toLowerCase());
}

// Word-boundary matchers. Each capability lists its trigger patterns;
// the router tries them in priority order (most specific first).

const SELECT_PATTERNS = [
  // Booking selection only: the target must read as an option reference
  // (ordinal, "option", or "one"). Bare demonstratives ("choose this
  // <place>", "select this place") are place language, not booking
  // language, and must fall through to search/clarification instead.
  /\b(use|choose|select|pick|go with)\b.{0,40}\b(option|options|first|second|third|one)\b/,
  /\b(first|second|third)\s+(one|option)\b/,
  /\buse\s+this\s+option\b/,
  /\b(option|options)\s+\d+\b/,
];

const RECHECK_PATTERNS = [
  /\bre-?check\b/,
  /\bfinal\s+check\b/,
  /\bcheck\b.{0,30}\bagain\b/,
  /\bverify\b.{0,30}\bagain\b/,
  /\bbefore\s+(the|my|our)\s+trip\b/,
  /\bpre-?trip\b/,
];

const RESCHEDULE_PATTERNS = [
  /\breschedul/,
  /\bdelay(ed)?\b/,
  /\brunning\s+late\b/,
  /\brunning\s+behind\b/,
  /\bstuck\b/,
  /\bmissed\b.{0,20}\b(flight|train|bus|booking|slot|tour)\b/,
  /\bchange\s+of\s+plan/,
  /\bplans?\s+changed\b/,
  /\bsomething\s+(came\s+up|changed)\b/,
];

const ACTIVATE_PATTERNS = [
  /\b(start|begin|activat(e|ion)|launch)\b.{0,20}\b(trip|journey|travel)\b/,
];

const FIX_PATTERNS = [
  /\b(fix|correct|repair|resolv(e|ing))\b.{0,30}\b(problems?|issues?|errors?|findings?|plans?|itinerar(y|ies)|trips?)\b/,
  /\b(propose|suggest|get|show)\b.{0,20}\b(fix|fixes|correction)\b/,
  /\b(replace|replacement|swap|swapping|substitut(e|ion|ing))\b/,
  /\bremove\b.{0,80}\b(alternative|another|replacement|instead)\b/,
  /\bchange\b.{0,30}\bactivit(y|ies)\b/,
  /\btoo\s+packed\b/,
  /\bmore\s+relaxed\b/,
];

const CHECK_PATTERNS = [
  /\b(check|verify|validate|review)\b.{0,30}\b(itinerar(y|ies)|it\b|plans?|trips?|schedules?)\b/,
  /\b(realistic|feasible|practical|possible)\b/,
  /\bsense-?check\b/,
  /\breality[ -]?check\b/,
];

const PLAN_PATTERNS = [
  /\bplan\b.{0,40}\b(trip|tour|vacation|holiday|itinerary|days?|getaway)\b/,
  /\btrip\s+to\b/,
  /\b\d+\s*days?\s+in\b/,
];

const BOOKING_DISCOVER_PATTERNS = [
  /\bbooking\s+option/,
  /\bwhere\s+(to|can\s+i)\s+book\b/,
  /\b(find|show|get)\b.{0,30}\bbooking\b/,
  /\b(reserv(e|ation)|book\s+a\s+(hotel|room|stay|ticket))\b/,
];

const PROGRESS_PATTERNS = [
  /\bwhere\s+am\s+i\b/,
  /\bwhat(?:'s|\s+is)\s+next\b/,
  /\bnext\s+(up|stop|item|activity|destination)\b/,
  /\bcurrent\s+day\b/,
  /\bmy\s+progress\b/,
  /\bam\s+i\s+(on|behind)\s+(schedule|track|time)\b/,
];

const STATUS_PATTERNS = [
  /\btrip\s+status\b/,
  /\bstatus\s+of\s+(my|the|our)\s+trip\b/,
  /\bhow(?:'s|\s+is)\s+(my|the|our)\s+trip\b/,
  /\btrip\s+(summary|overview)\b/,
  /\bmy\s+itinerary\s+status\b/,
];

const IDENTIFY_PATTERNS = [
  /\bwhat(?:'s|\s+is)\s+this\b/,
  /\bwhat\s+(monument|temple|fort|palace|place|building)\s+is\s+this\b/,
  /\bwhich\s+(monument|temple|fort|palace|place)\b/,
  /\b(this|that)\s+(photo|picture|image)\b/,
  /\bidentify\b.{0,30}\b(monument|temple|fort|palace|place|building|photo|picture)\b/,
];

/** Travel-domain signals. Absent signal + no trip context → out_of_scope. */
const TRAVEL_SIGNAL_PATTERNS = [
  /\bhotel|stay|room|resort|hostel|villa\b/,
  /\bvisit|attraction|sightseeing|landmark|touris|explore\b/,
  /\btrip|travel|tour|journey|vacation|holiday|itinerary|destination\b/,
  /\bbook|reserv|ticket|flight|train|bus|visa|passport|luggage\b/,
  /\brestaurant|food|cuisine|menu\b/,
  /\bmap|drive|route|distance\b/,
  /\bphoto|picture|monument|temple|fort|palace|museum\b/,
];

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => has(message, pattern));
}

function clarify(
  query: string,
  destination: string | undefined,
  missing: string[],
  clarification: string,
): AgentIntent {
  return agentIntentSchema.parse({
    intent: "needs_clarification",
    query,
    ...(destination ? { destination } : {}),
    missing,
    clarification,
  });
}

/**
 * Deterministic capability router. Pure: same (message, context) always
 * yields the same intent; never performs I/O. Throws ValidationError on
 * empty or over-long messages (same limits as Phase 3).
 */
export function resolveAgentIntent(
  message: string,
  context: RoutingContextInput = {},
  now: Date = new Date(),
): AgentIntent {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new ValidationError("Message must be non-empty.");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(
      `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }
  const ctx = routingContextSchema.parse(context);
  const query = trimmed.slice(0, 300);
  const destination =
    ctx.destination?.trim() || extractDestination(trimmed) || undefined;
  const hasPlan = ctx.hasActivePlan;
  const isApproved = ctx.tripStatus === "APPROVED";
  const canStart =
    ctx.tripStatus !== undefined && canActivate(ctx.tripStatus);

  // Most specific capability matchers first. Each gates on required
  // context and degrades to clarification — never to a guessed action.

  if (matchesAny(trimmed, SELECT_PATTERNS)) {
    if (!ctx.hasBookingOptions && !ctx.hasSelections) {
      return clarify(query, destination, ["booking_options"], 
        "There are no discovered booking options yet. Discover booking options for your approved trip first, then tell me which one to use.",
      );
    }
    return agentIntentSchema.parse({ intent: "booking_select", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, RECHECK_PATTERNS)) {
    if (!hasPlan) {
      return clarify(query, destination, ["active_plan"],
        "There is no active trip plan to recheck. Plan a trip first, then I can run the final pre-trip check.",
      );
    }
    return agentIntentSchema.parse({ intent: "booking_recheck", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, RESCHEDULE_PATTERNS)) {
    if (!hasPlan && !ctx.hasActiveTrip) {
      return clarify(query, destination, ["active_plan_or_trip"],
        "There is no active plan or trip to reschedule. Tell me about your trip first.",
      );
    }
    return agentIntentSchema.parse({ intent: "reschedule_advice", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, ACTIVATE_PATTERNS)) {
    if (!canStart) {
      return clarify(query, destination, ["approvable_plan"],
        "Your trip is not ready to start yet. Approve your itinerary first, then ask me to start the trip.",
      );
    }
    return agentIntentSchema.parse({ intent: "activate_trip", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, FIX_PATTERNS)) {
    if (!hasPlan && !ctx.hasRecentCheck) {
      return clarify(query, destination, ["active_plan"],
        "There is nothing to fix yet. Plan a trip and run a RealityCheck first, then I can propose fixes.",
      );
    }
    return agentIntentSchema.parse({ intent: "fix_trip", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, CHECK_PATTERNS)) {
    if (!hasPlan) {
      return clarify(query, destination, ["active_plan"],
        "There is no itinerary to check yet. Share or plan a trip first, then ask me to check it.",
      );
    }
    return agentIntentSchema.parse({ intent: "check_trip", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, PLAN_PATTERNS)) {
    if (!destination) {
      return clarify(query, undefined, ["destination"],
        "Where would you like to go? Tell me a destination and I can plan the trip.",
      );
    }
    return agentIntentSchema.parse({ intent: "plan_trip", query, destination, missing: [] });
  }

  if (matchesAny(trimmed, BOOKING_DISCOVER_PATTERNS)) {
    if (!isApproved) {
      return clarify(query, destination, ["approved_plan"],
        "Booking discovery needs an approved itinerary. Approve your trip plan first, then ask me to find booking options.",
      );
    }
    return agentIntentSchema.parse({ intent: "booking_discover", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, PROGRESS_PATTERNS)) {
    if (!ctx.hasActiveTrip) {
      return clarify(query, destination, ["active_trip"],
        "No trip is currently active. Start your trip first, then ask me what's next.",
      );
    }
    return agentIntentSchema.parse({ intent: "trip_progress", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, STATUS_PATTERNS)) {
    if (!hasPlan && !ctx.hasActiveTrip) {
      return clarify(query, destination, ["active_plan_or_trip"],
        "There is no trip to report on yet. Plan a trip first.",
      );
    }
    return agentIntentSchema.parse({ intent: "trip_status", query, ...(destination ? { destination } : {}), missing: [] });
  }

  if (matchesAny(trimmed, IDENTIFY_PATTERNS)) {
    return agentIntentSchema.parse({ intent: "identify_place", query, ...(destination ? { destination } : {}), missing: [] });
  }

  // No capability matched. Without any travel-domain signal or trip
  // context, the request is explicitly out of scope — never forced into
  // a search. Otherwise preserve exact Phase 3 behavior via delegation.
  const hasSignal =
    matchesAny(trimmed, TRAVEL_SIGNAL_PATTERNS) ||
    destination !== undefined ||
    hasPlan ||
    ctx.hasActiveTrip;
  if (!hasSignal) {
    return agentIntentSchema.parse({
      intent: "out_of_scope",
      query,
      missing: [],
      clarification:
        "I help with travel planning, verification, booking handoff, live-trip tracking, and place identification. Ask me about a destination or one of those, and I will route you to the right capability.",
    });
  }

  const legacy: TravelIntent = resolveIntent(
    trimmed,
    { destination: ctx.destination },
    now,
  );
  return agentIntentSchema.parse({
    intent: legacy.intent,
    query: legacy.query,
    ...(legacy.destination ? { destination: legacy.destination } : {}),
    engine: legacy.engine,
    missing: [],
  });
}
