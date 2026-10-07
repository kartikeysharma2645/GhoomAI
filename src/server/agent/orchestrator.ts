import { z } from "zod";
import {
  ConfigurationError,
  ConflictError,
  UpstreamError,
  ValidationError,
} from "../../lib/errors";
import { TRIP_INTERESTS } from "../interests";
import { tripSummary, type TripSummary } from "../livetrip/progress";
import { applyReschedule } from "../livetrip/applyReschedule";
import { proposeReschedule } from "../livetrip/reschedule";
import { checkLiveSituation } from "../livetrip/liveCheck";
import { activateTrip } from "../livetrip/activeTrip";
import { applyReplanProposal } from "../realitycheck/apply";
import { fixTrip } from "../realitycheck/fixer";
import { replanProposalSchema } from "../realitycheck/proposal";
import { rescheduleProposalSchema } from "../livetrip/reschedule";
import { checkTrip } from "../realitycheck/service";
import { SerpApiClient } from "../services/serpapi/client";
import { planTrip } from "../trips/service";
import type { TripPlanRequest } from "../trips/requirements";
import { discoverBookingOptions } from "../booking/discovery";
import {
  appendTranscriptEntry,
  conversationSessionSchema,
  MAX_TRANSCRIPT_ENTRIES,
  pendingConfirmationSchema,
  type ConversationSession,
} from "./session";
import { validateSelection } from "../booking/selection";
import { bookingOptionSchema } from "../booking/types";
import { runFinalRecheck } from "../booking/recheck";
import {
  AGENT_INTENT_NAMES,
  contextFromSession,
  resolveAgentIntent,
} from "./router";
import {
  hasPaceChangeLanguage,
  hasReplacementLanguage,
  resolveFixTargets,
} from "./fixTargeting";
import { executeIntent } from "./responder";
import { extractDestination, resolveIntent } from "./intent";
import { analyzeImage } from "../vision/service";

/**
 * Phase 10 Prompt 2 deterministic orchestrator: one capability action per
 * conversational turn, dispatched from the Prompt 1 intent taxonomy into
 * EXISTING services. No duplicated business logic, no direct SerpApi calls
 * (services own their gateway use), no LLM, no hidden multi-step chains.
 *
 * Single-action invariant: each turn executes at most one service call
 * that performs work (plan / check / propose / discover / select /
 * recheck / activate / analyze / search). Suggesting a follow-up is not
 * executing it — the next turn decides.
 *
 * Approval gates: activate_trip, booking_select, apply_fix, and
 * apply_reschedule NEVER execute from intent classification alone. The
 * first turn returns `confirmation_required` and records
 * `pendingConfirmation` (context only, never authority). Execution happens
 * only when the next turn carries an explicit `confirm` payload matching
 * the pending action, a confirmation phrase, and freshly revalidated state.
 */

export const PENDING_TTL_MS = 30 * 60 * 1000;

export const TURN_OUTCOMES = [
  "completed",
  "clarification",
  "out_of_scope",
  "confirmation_required",
  "confirmation_rejected",
  "failed",
] as const;

export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/**
 * Explicit confirmation payload for the next turn. Proposals are resubmitted
 * (never stored in session) so apply calls revalidate changeIds against the
 * current plan through the existing apply services.
 */
export const confirmPayloadSchema = z.object({
  action: z.enum([
    "activate_trip",
    "apply_fix",
    "apply_reschedule",
    "booking_select",
  ]),
  changeIds: z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  proposal: z.union([replanProposalSchema, rescheduleProposalSchema]).optional(),
  itemId: z.string().min(1).max(100).optional(),
  option: z.unknown().optional(),
});

export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;

export interface AgentTurnResponse {
  intent: (typeof AGENT_INTENT_NAMES)[number];
  outcome: TurnOutcome;
  /** Service invoked this turn ("none" when no capability ran). */
  capability: string;
  message: string;
  /** Structured result for UI embedding (plan, check, proposal, ...). */
  data?: unknown;
  followUps: string[];
  confirmationRequired?: z.infer<typeof pendingConfirmationSchema>;
  errorCode?: string;
  session: ConversationSession;
}

export interface OrchestratorDeps {
  client?: SerpApiClient;
  now?: Date;
  image?: { bytes: Uint8Array; mimeType?: string };
}

const CONFIRM_RE =
  /^(yes|yeah|yep|sure|ok|okay|confirm|confirmed|go ahead|do it|proceed|please do)\b/;
const CANCEL_RE =
  /^(no|nope|cancel|cancelled|canceled|stop|never mind|don't|dont|not now)\b/;

/**
 * Honest scope note appended to discovery turns that ran without any
 * geographic context (Phase 2.5 Fix 1). The search itself stays broad and
 * global rather than pretending to be local — the note says so plainly.
 */
const BROAD_DISCOVERY_NOTE =
  " These are broad travel ideas — name a destination or region to narrow the results.";

/**
 * Extracts trip interests stated in a message, using the same vocabulary
 * the planner uses. Pure and deterministic; returns [] when none stated.
 */
export function extractInterests(message: string): string[] {
  const interestMatchers: Record<string, RegExp> = {
    history: /\b(histor|heritage|fort|palace|museum)\w*\b/i,
    food: /\b(food|cuisine|restaurant|dining)\b/i,
    photography: /\b(photo|photography|instagram)\b/i,
    nature: /\b(nature|park|wildlife)\b/i,
    shopping: /\b(shop|market|souvenir)\b/i,
    nightlife: /\b(nightlife|night life|pub|bar|club)\b/i,
  };
  const interests: string[] = [];
  for (const interest of TRIP_INTERESTS) {
    const matcher = interestMatchers[interest];
    if (matcher && matcher.test(message)) interests.push(interest);
  }
  return interests;
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\bfirst\b/, 1],
  [/\bsecond\b/, 2],
  [/\bthird\b/, 3],
];

function extractOrdinal(message: string): number | null {
  const lower = message.toLowerCase();
  for (const [pattern, value] of ORDINALS) {
    if (pattern.test(lower)) return value;
  }
  const numbered = lower.match(/\b(\d+)(st|nd|rd|th)?\b/);
  if (numbered) {
    const value = Number.parseInt(numbered[1], 10);
    if (Number.isInteger(value) && value >= 1 && value <= 10) return value;
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Parses a digit or English number word (one–twelve) into a count. */
function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return NUMBER_WORDS[raw.toLowerCase()];
}

const COUNT_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";

/**
 * Merges freshly extracted planning fields over a pending draft from a
 * previous needs_input turn. Only defined fields overwrite. A newly stated
 * destination different from the draft's starts a fresh trip (the old
 * draft's dates and party may not apply); otherwise fields accumulate.
 * Pure and deterministic.
 */
export function mergePlanRequest(
  draft: TripPlanRequest | undefined,
  fresh: TripPlanRequest,
): TripPlanRequest {
  if (!draft) return fresh;
  if (
    fresh.destination !== undefined &&
    draft.destination !== undefined &&
    fresh.destination !== draft.destination
  ) {
    return fresh;
  }
  return { ...draft, ...fresh };
}

/** Deterministic planning-field extraction. Only what the text states. */
export function extractPlanRequest(message: string): TripPlanRequest {
  const request: TripPlanRequest = {};
  // Single canonical destination extractor (shared with intent routing),
  // so the router gate and the field extraction can never disagree.
  const destination = extractDestination(message);
  if (destination) request.destination = destination;
  const duration = message.match(/(\d+)\s*-?\s*(?:[a-z]+\s+){0,2}days?\b/i);
  if (duration) request.durationDays = Number.parseInt(duration[1], 10);
  const dates = message.match(/\d{4}-\d{2}-\d{2}/g);
  if (dates && dates.length >= 2) {
    request.startDate = dates[0];
    request.endDate = dates[1];
  }
  const adults = message.match(
    new RegExp(`(\\d+|${COUNT_WORDS})\\s*(adults?|people|persons|travell?ers?|guests?)`, "i"),
  );
  const adultCount = parseCount(adults?.[1]);
  if (adultCount !== undefined) request.adults = adultCount;
  const children = message.match(
    new RegExp(`(\\d+|${COUNT_WORDS})\\s*(child|children|kids?)`, "i"),
  );
  const childCount = parseCount(children?.[1]);
  if (childCount !== undefined) request.children = childCount;
  const teenagers = message.match(
    new RegExp(`(\\d+|${COUNT_WORDS})\\s*(teenagers?|teens?)`, "i"),
  );
  const teenagerCount = parseCount(teenagers?.[1]);
  if (teenagerCount !== undefined) request.teenagers = teenagerCount;
  const seniors = message.match(
    new RegExp(`(\\d+|${COUNT_WORDS})\\s*(seniors?|elderly)`, "i"),
  );
  const seniorCount = parseCount(seniors?.[1]);
  if (seniorCount !== undefined) request.seniors = seniorCount;
  const budget = message.match(
    /(?:budget|under|up\s*to|within|max)\s*(?:inr|rs|₹)?\s*([\d,]+)|(?:inr|rs|₹)\s*([\d,]+)|([\d,]+)\s*(?:inr|rs|rupees?)/i,
  );
  if (budget) {
    const raw = (budget[1] ?? budget[2] ?? budget[3] ?? "").replace(/,/g, "");
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount > 0) {
      request.budget = { amount };
    }
  }
  const interests = extractInterests(message);
  if (interests.length > 0) {
    request.interests = interests.slice(0, 6) as TripPlanRequest["interests"];
  }
  if (/\b(relaxed|leisurely|slow)\b/i.test(message)) request.pace = "relaxed";
  else if (/\b(packed|hectic|fast-paced|ambitious)\b/i.test(message)) {
    request.pace = "packed";
  } else if (/\bbalanced\b/i.test(message)) request.pace = "balanced";
  if (/flexib|anytime|any\s+dates|open\s+dates/i.test(message)) {
    request.flexibleDates = true;
  }
  return request;
}

function failedTurn(
  intent: AgentTurnResponse["intent"],
  capability: string,
  err: unknown,
  followUps: string[] = [],
): Omit<AgentTurnResponse, "session"> {
  const message =
    err instanceof UpstreamError
      ? `${err.message} You can retry this turn — nothing was changed.`
      : err instanceof ConfigurationError
        ? err.message
        : err instanceof Error
          ? err.message
          : "This turn failed without changing anything.";
  const errorCode =
    err instanceof UpstreamError || err instanceof ConfigurationError
      ? err.code
      : err instanceof ConflictError
        ? err.code
        : err instanceof ValidationError
          ? err.code
          : "INTERNAL_ERROR";
  return {
    intent,
    outcome: "failed",
    capability,
    message: message.slice(0, 2000),
    followUps,
    errorCode,
  };
}

function withAssistantEntry(
  session: ConversationSession,
  text: string,
  action: { capability: string; status: "proposed" | "completed" | "failed" },
  now: Date,
): ConversationSession {
  return appendTranscriptEntry(session, {
    role: "assistant",
    text,
    action,
    now,
  });
}

/**
 * Executes one conversational turn. Pure orchestration over existing
 * services with an injectable gateway client and clock. Throws only for
 * malformed session/message input (route maps to 400); service failures
 * become `failed` outcomes with the pre-turn state preserved.
 */
export async function orchestrateTurn(
  session: ConversationSession,
  message: string,
  confirm: ConfirmPayload | undefined,
  deps: OrchestratorDeps = {},
): Promise<AgentTurnResponse> {
  const parsed = conversationSessionSchema.safeParse(session);
  if (!parsed.success) {
    throw new ValidationError("Conversation session is invalid.");
  }
  const trimmed = message.trim();
  if (!trimmed) throw new ValidationError("Message must be non-empty.");
  if (trimmed.length > 500) {
    throw new ValidationError("Message must be at most 500 characters.");
  }
  if (parsed.data.transcript.length + 2 > MAX_TRANSCRIPT_ENTRIES) {
    throw new ValidationError(
      `Conversation transcript is full (${MAX_TRANSCRIPT_ENTRIES} entries). Start a new session to continue.`,
    );
  }
  const now = deps.now ?? new Date();
  const client = deps.client;
  let working = appendTranscriptEntry(parsed.data, {
    role: "user",
    text: trimmed,
    now,
  });
  const pending = working.pendingConfirmation ?? null;

  const finish = (
    response: Omit<AgentTurnResponse, "session">,
    updates: Partial<ConversationSession> = {},
    assistantAction?: { capability: string; status: "proposed" | "completed" | "failed" },
  ): AgentTurnResponse => {
    const next: ConversationSession = conversationSessionSchema.parse({
      ...working,
      ...updates,
    });
    const withEntry = assistantAction
      ? withAssistantEntry(next, response.message, assistantAction, now)
      : next;
    return { ...response, session: withEntry };
  };

  // ---- Confirmation handling (before routing) ----
  if (confirm !== undefined) {
    if (!pending) {
      return finish(
        {
          intent: "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: "There is no pending action to confirm. Tell me what you would like to do.",
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    if (confirm.action !== pending.action) {
      const cleared = { ...working, pendingConfirmation: undefined };
      working = conversationSessionSchema.parse(cleared);
      return finish(
        {
          intent: "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: `That confirmation does not match the pending action (${pending.action}). It was discarded — please request the action again.`,
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    if (now.getTime() - Date.parse(pending.requestedAt) > PENDING_TTL_MS) {
      const cleared = { ...working, pendingConfirmation: undefined };
      working = conversationSessionSchema.parse(cleared);
      return finish(
        {
          intent: "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: "That confirmation has expired. Please request the action again.",
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    const lower = trimmed.toLowerCase();
    if (CANCEL_RE.test(lower)) {
      const cleared = { ...working, pendingConfirmation: undefined };
      working = conversationSessionSchema.parse(cleared);
      return finish(
        {
          intent: pending.action === "activate_trip" ? "activate_trip" : "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: "Cancelled — nothing was executed.",
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    if (!CONFIRM_RE.test(lower)) {
      const cleared = { ...working, pendingConfirmation: undefined };
      working = conversationSessionSchema.parse(cleared);
      return finish(
        {
          intent: "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: "Please confirm explicitly (for example: “Yes, go ahead”) or cancel. The pending action was discarded.",
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    // Explicit, matching, fresh confirmation → execute exactly one action.
    try {
      if (pending.action === "activate_trip") {
        const plan = working.activePlan;
        const fromStatus = working.tripStatus;
        if (!plan || (fromStatus !== "VERIFIED" && fromStatus !== "APPROVED")) {
          throw new ConflictError("The trip is no longer in an activatable state.");
        }
        const trip = activateTrip(plan, fromStatus, now);
        return finish(
          {
            intent: "activate_trip",
            outcome: "completed",
            capability: "activateTrip",
            message: `Trip started. Day ${trip.currentDayNumber} of ${trip.plan.durationDays} in ${trip.plan.destination} — ask me “what's next?” as you travel.`,
            data: { trip },
            followUps: ["What's next?", "Check the live situation"],
          },
          {
            tripStatus: "ACTIVE",
            activeTrip: trip,
            pendingConfirmation: undefined,
          },
          { capability: "activateTrip", status: "completed" },
        );
      }
      if (pending.action === "booking_select") {
        if (!confirm.itemId || !confirm.option) {
          throw new ValidationError("Confirmation must identify the option to select.");
        }
        const option = bookingOptionSchema.parse(confirm.option);
        if (option.itemId !== confirm.itemId) {
          throw new ValidationError("Option does not belong to the confirmed item.");
        }
        if (!working.activePlan || working.tripStatus !== "APPROVED") {
          throw new ConflictError("Selection requires an approved trip plan.");
        }
        const selection = validateSelection({
          plan: working.activePlan,
          status: working.tripStatus,
          itemId: confirm.itemId,
          option,
          now,
        });
        const kept = (working.selections ?? []).filter(
          (s) => s.itemId !== selection.itemId,
        );
        return finish(
          {
            intent: "booking_select",
            outcome: "completed",
            capability: "validateSelection",
            message: `Selected “${selection.title}” via ${selection.provider} for external handoff. GhoomAI did not complete any booking — continue with the provider yourself.`,
            data: { selection },
            followUps: ["Run the final pre-trip check"],
          },
          {
            selections: [...kept, option],
            pendingConfirmation: undefined,
          },
          { capability: "validateSelection", status: "completed" },
        );
      }
      if (pending.action === "apply_fix" || pending.action === "apply_reschedule") {
        if (!confirm.changeIds || !confirm.proposal) {
          throw new ValidationError("Confirmation must include change IDs and the proposal.");
        }
        if (!working.activePlan) {
          throw new ConflictError("There is no active plan to apply changes to.");
        }
        if (pending.action === "apply_fix") {
          const proposal = replanProposalSchema.parse(confirm.proposal);
          const result = applyReplanProposal(working.activePlan, proposal, confirm.changeIds);
          return finish(
            {
              intent: "fix_trip",
              outcome: "completed",
              capability: "applyReplanProposal",
              message: `Applied ${result.appliedChangeIds.length} fix(es). The plan changed, so run RealityCheck again before approving.`,
              data: { plan: result.plan, appliedChangeIds: result.appliedChangeIds },
              followUps: ["Run RealityCheck"],
            },
            {
              activePlan: result.plan,
              tripStatus: "PLANNED",
              latestCheck: undefined,
              latestDiscovery: undefined,
              selections: undefined,
              pendingConfirmation: undefined,
            },
            { capability: "applyReplanProposal", status: "completed" },
          );
        }
        const trip = working.activeTrip;
        if (!trip) throw new ConflictError("There is no active trip to reschedule.");
        const proposal = rescheduleProposalSchema.parse(confirm.proposal);
        const result = applyReschedule(trip, proposal, confirm.changeIds);
        return finish(
          {
            intent: "reschedule_advice",
            outcome: "completed",
            capability: "applyReschedule",
            message: `Applied ${result.appliedChangeIds.length} reschedule change(s). Ask me what's next to continue.`,
            data: { trip: result.trip, appliedChangeIds: result.appliedChangeIds },
            followUps: ["What's next?"],
          },
          { activeTrip: result.trip, pendingConfirmation: undefined },
          { capability: "applyReschedule", status: "completed" },
        );
      }
      throw new ValidationError("Unknown pending action.");
    } catch (err) {
      return finish(failedTurn("needs_clarification", "none", err), {
        pendingConfirmation: undefined,
      });
    }
  }

  // A bare confirmation phrase without a confirm payload cannot execute:
  // the action needs its payload (change IDs, option). Keep pending.
  if (pending && CONFIRM_RE.test(trimmed.toLowerCase())) {
    return finish(
      {
        intent: "needs_clarification",
        outcome: "clarification",
        capability: "none",
        message: `I have “${pending.summary}” waiting. Please confirm using the confirmation control so I know exactly what to execute.`,
        followUps: [],
      },
      {},
      { capability: "none", status: "proposed" },
    );
  }
  // Any other new message supersedes a stale pending action.
  if (pending) {
    if (CANCEL_RE.test(trimmed.toLowerCase())) {
      const cleared = { ...working, pendingConfirmation: undefined };
      working = conversationSessionSchema.parse(cleared);
      return finish(
        {
          intent: "needs_clarification",
          outcome: "confirmation_rejected",
          capability: "none",
          message: "Cancelled — nothing was executed.",
          followUps: [],
        },
        {},
        { capability: "none", status: "failed" },
      );
    }
    const cleared = { ...working, pendingConfirmation: undefined };
    working = conversationSessionSchema.parse(cleared);
  }

  // ---- Route and dispatch (exactly one capability action) ----
  const routed = resolveAgentIntent(trimmed, contextFromSession(working), now);

  // Clarification continuation: when a plan_trip turn previously ended in
  // needs_input, its partial requirements wait in pendingPlanRequest. If the
  // new message classifies as ambiguous (needs_clarification/out_of_scope)
  // but states fresh planning fields, resume planning with the merged
  // request instead of dropping context. Explicit capability intents always
  // take precedence, so unrelated requests are never hijacked.
  const draft = working.pendingPlanRequest;
  let effectiveIntent = routed.intent;
  let planRequestOverride: TripPlanRequest | undefined;
  if (
    draft &&
    (routed.intent === "needs_clarification" ||
      routed.intent === "out_of_scope")
  ) {
    const fresh = extractPlanRequest(trimmed);
    if (Object.keys(fresh).length > 0) {
      effectiveIntent = "plan_trip";
      planRequestOverride = mergePlanRequest(draft, fresh);
    }
  }
  const base = { intent: effectiveIntent } as const;

  if (effectiveIntent === "needs_clarification") {
    return finish(
      {
        ...base,
        outcome: "clarification",
        capability: "none",
        message: routed.clarification ?? "Could you clarify?",
        followUps: [],
      },
      {},
      { capability: "none", status: "proposed" },
    );
  }
  if (effectiveIntent === "out_of_scope") {
    return finish(
      {
        ...base,
        outcome: "out_of_scope",
        capability: "none",
        message: routed.clarification ?? "I can't help with that.",
        followUps: ["Plan a trip", "Find hotels", "Discover places"],
      },
      {},
      { capability: "none", status: "proposed" },
    );
  }

  try {
    switch (effectiveIntent) {
      case "find_hotels":
      case "discover_places":
      case "general_search": {
        // Location-aware discovery (Phase 2.5 Fix 1): reuse geographic
        // context the user already gave — the active plan's destination,
        // then their own partial planning requirements, then whatever the
        // router extracted from this message. Never invented, never a
        // hardcoded default region; without context the search stays
        // honestly broad (see BROAD_DISCOVERY_NOTE below).
        const discoveryDestination =
          working.activePlan?.destination ??
          working.pendingPlanRequest?.destination ??
          undefined;
        const legacy = resolveIntent(
          trimmed,
          { destination: discoveryDestination },
          now,
        );
        const data = await executeIntent(legacy, client ?? new SerpApiClient());
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "executeIntent",
            message:
              data.message +
              (legacy.destination ? "" : BROAD_DISCOVERY_NOTE),
            data,
            followUps: ["Plan a trip here", "Discover more places"],
          },
          {},
          { capability: "executeIntent", status: "completed" },
        );
      }
      case "plan_trip": {
        const request =
          planRequestOverride ??
          mergePlanRequest(draft, extractPlanRequest(trimmed));
        const result = await planTrip(request, client, now);
        if (result.status === "needs_input") {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "planTrip",
              message: result.message,
              data: { missing: result.missing },
              followUps: [],
            },
            { pendingPlanRequest: request },
            { capability: "planTrip", status: "proposed" },
          );
        }
        const days = result.plan.durationDays;
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "planTrip",
            message: `Planned a ${days}-day trip to ${result.plan.destination}. Run RealityCheck next to verify it before approving.`,
            data: { plan: result.plan },
            followUps: ["Run RealityCheck", "Find booking options"],
          },
          { activePlan: result.plan, tripStatus: "PLANNED", pendingPlanRequest: undefined },
          { capability: "planTrip", status: "completed" },
        );
      }
      case "check_trip": {
        const plan = working.activePlan;
        if (!plan) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "There is no itinerary to check yet. Share or plan a trip first.",
              followUps: ["Plan a trip"],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const check = await checkTrip(plan, client, now);
        const actionable = check.summary.problem + check.summary.needsAttention;
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "checkTrip",
            message:
              actionable > 0
                ? `RealityCheck found ${actionable} item(s) needing attention (${check.summary.problem} problem, ${check.summary.needsAttention} needs attention). Ask me to propose fixes.`
                : `RealityCheck is clean: ${check.summary.verified} verified, ${check.summary.unverified} unverified. You can approve and find booking options.`,
            data: { check },
            followUps:
              actionable > 0
                ? ["Propose fixes"]
                : ["Find booking options", "Run the final pre-trip check"],
          },
          { latestCheck: check },
          { capability: "checkTrip", status: "completed" },
        );
      }
      case "fix_trip": {
        const plan = working.activePlan;
        const check = working.latestCheck;
        if (!plan || !check) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "I need a checked itinerary first. Run RealityCheck, then ask me to propose fixes.",
              followUps: ["Run RealityCheck"],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const targeting = resolveFixTargets(plan, trimmed);
        if (targeting.kind === "ambiguous") {
          const listed =
            targeting.candidates.length > 0
              ? targeting.candidates
                  .map((c) => `Day ${c.dayNumber}: ${c.title}`)
                  .join("; ")
              : null;
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: listed
                ? `Which activity should I replace? ${listed}. Name it and mention what kind of place you want instead.`
                : "I couldn't find a replaceable activity matching that description. Tell me the day number and the activity title.",
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        if (
          !hasReplacementLanguage(trimmed) &&
          hasPaceChangeLanguage(trimmed)
        ) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message:
                "I can replace specific activities with verified alternatives, but changing the overall pace needs a fresh plan. Tell me which activity to replace and what kind of place you prefer.",
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const replaceItemIds =
          targeting.kind === "targets" ? targeting.itemIds : undefined;
        const interests = extractInterests(trimmed);
        const proposal = await fixTrip(
          {
            plan,
            check,
            requirements: {
              destination: plan.destination,
              dateMode: plan.dateMode,
              ...(plan.startDate ? { startDate: plan.startDate } : {}),
              ...(plan.endDate ? { endDate: plan.endDate } : {}),
              durationDays: plan.durationDays,
              adults: plan.party.adults,
              children: plan.party.children,
              interests,
              pace: "balanced",
            },
            ...(replaceItemIds ? { replaceItemIds } : {}),
          },
          client,
          now,
        );
        if (proposal.changes.length === 0) {
          return finish(
            {
              ...base,
              outcome: "completed",
              capability: "fixTrip",
              message: "No live alternatives could be verified right now — nothing to propose. Your plan is unchanged.",
              data: { proposal },
              followUps: ["Check the itinerary again"],
            },
            {},
            { capability: "fixTrip", status: "completed" },
          );
        }
        return finish(
          {
            ...base,
            outcome: "confirmation_required",
            capability: "fixTrip",
            message: `I found ${proposal.changes.length} verified fix(es). Nothing is applied yet — confirm to apply them, or pick specific ones.`,
            data: { proposal },
            // Apply/Keep travel through the Confirm/Cancel buttons built
            // from confirmationRequired, so no text follow-up may imply them.
            followUps: [],
            confirmationRequired: {
              action: "apply_fix",
              summary: `Apply ${proposal.changes.length} proposed fix(es) to the itinerary.`,
              requestedAt: now.toISOString(),
            },
          },
          {
            pendingConfirmation: {
              action: "apply_fix",
              summary: `Apply ${proposal.changes.length} proposed fix(es) to the itinerary.`,
              requestedAt: now.toISOString(),
            },
          },
          { capability: "fixTrip", status: "proposed" },
        );
      }
      case "booking_discover": {
        const plan = working.activePlan;
        if (!plan || working.tripStatus !== "APPROVED") {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "Booking discovery needs an approved itinerary. Approve your trip plan first.",
              followUps: ["Run RealityCheck"],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const discovery = await discoverBookingOptions(
          { plan, status: working.tripStatus },
          client,
          now,
        );
        const count = discovery.items.filter((i) => i.status === "READY").length;
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "discoverBookingOptions",
            message: `Found live options for ${count} item(s). Tell me which option to use (for example: “use the first one”) — I will ask for confirmation before recording it.`,
            data: { discovery },
            followUps: ["Use the first option", "Run the final pre-trip check"],
          },
          { latestDiscovery: discovery.items },
          { capability: "discoverBookingOptions", status: "completed" },
        );
      }
      case "booking_select": {
        const items = working.latestDiscovery ?? [];
        const flat = items.flatMap((item) =>
          item.options.map((option) => ({ itemId: item.itemId, option })),
        );
        let picked: { itemId: string; option: (typeof flat)[number]["option"] } | null = null;
        if (flat.length === 1 && flat[0]) {
          picked = { itemId: flat[0].itemId, option: flat[0].option };
        } else {
          const ordinal = extractOrdinal(trimmed);
          if (ordinal !== null && ordinal >= 1 && ordinal <= flat.length && flat[ordinal - 1]) {
            const entry = flat[ordinal - 1];
            picked = { itemId: entry.itemId, option: entry.option };
          }
        }
        if (!picked) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message:
                flat.length === 0
                  ? "There are no discovered options to choose from. Discover booking options first."
                  : `I found ${flat.length} options — tell me which one by number (for example: “use the second one”).`,
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const summary = `Record “${picked.option.title}” via ${picked.option.provider} for external handoff. GhoomAI will not complete any booking.`;
        return finish(
          {
            ...base,
            outcome: "confirmation_required",
            capability: "none",
            message: `${summary} Please confirm explicitly to record this selection.`,
            data: { itemId: picked.itemId, option: picked.option },
            followUps: [],
            confirmationRequired: {
              action: "booking_select",
              summary,
              requestedAt: now.toISOString(),
            },
          },
          {
            pendingConfirmation: {
              action: "booking_select",
              summary,
              requestedAt: now.toISOString(),
            },
          },
          { capability: "none", status: "proposed" },
        );
      }
      case "booking_recheck": {
        const plan = working.activePlan;
        if (!plan || working.tripStatus !== "APPROVED") {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "The final pre-trip check needs an approved itinerary.",
              followUps: ["Run RealityCheck"],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const recheck = await runFinalRecheck(
          { plan, status: working.tripStatus, selections: working.selections ?? [] },
          client,
          now,
        );
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "runFinalRecheck",
            message:
              recheck.verdict === "CLEAR"
                ? "Final pre-trip check is CLEAR — the itinerary was freshly verified against live evidence. This is not a booking."
                : `Final pre-trip check: ${recheck.verdict}. ${recheck.summary.problem} problem(s), ${recheck.summary.needsAttention} needing attention. Review the findings before proceeding — nothing was changed.`,
            data: { recheck },
            followUps:
              recheck.verdict === "CLEAR"
                ? ["Start my trip"]
                : ["Propose fixes", "Check the itinerary again"],
          },
          {},
          { capability: "runFinalRecheck", status: "completed" },
        );
      }
      case "activate_trip": {
        const plan = working.activePlan;
        const activatable =
          plan !== undefined &&
          (working.tripStatus === "VERIFIED" || working.tripStatus === "APPROVED");
        if (!activatable) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "Your trip is not ready to start yet. Approve your itinerary first, then ask me to start the trip.",
              followUps: ["Run RealityCheck"],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const summary = `Start the ${plan.durationDays}-day trip to ${plan.destination}? This begins live tracking.`;
        return finish(
          {
            ...base,
            outcome: "confirmation_required",
            capability: "none",
            message: `${summary} Please confirm explicitly.`,
            followUps: [],
            confirmationRequired: {
              action: "activate_trip",
              summary,
              requestedAt: now.toISOString(),
            },
          },
          {
            pendingConfirmation: {
              action: "activate_trip",
              summary,
              requestedAt: now.toISOString(),
            },
          },
          { capability: "none", status: "proposed" },
        );
      }
      case "trip_status": {
        const plan = working.activePlan;
        const statusLine = `Trip status: ${working.tripStatus}.`;
        const detail = plan
          ? ` ${plan.destination}, ${plan.durationDays} day(s)` +
            (plan.startDate && plan.endDate ? ` (${plan.startDate} → ${plan.endDate})` : " (flexible dates)") +
            "."
          : " No active plan in this conversation yet.";
        const trip = working.activeTrip;
        const live: TripSummary | null = trip ? tripSummary(trip) : null;
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "tripSummary",
            message:
              statusLine + detail + (live ? ` Live trip: ${live.completed}/${live.total} done, ${live.remaining} remaining.` : ""),
            data: { tripStatus: working.tripStatus, summary: live },
            followUps: trip ? ["What's next?"] : ["Plan a trip"],
          },
          {},
          { capability: "tripSummary", status: "completed" },
        );
      }
      case "trip_progress": {
        const trip = working.activeTrip;
        if (!trip) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "No trip is currently active in this conversation. Start your trip first.",
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const summary = tripSummary(trip);
        const day = trip.progress.find((d) => d.dayNumber === trip.currentDayNumber);
        const upcoming = day?.items.filter((i) => i.status === "UPCOMING").length ?? 0;
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "tripSummary",
            message: `Day ${trip.currentDayNumber} of ${trip.plan.durationDays}: ${upcoming} upcoming item(s) today, ${summary.remaining} remaining overall.`,
            data: { summary, currentDayNumber: trip.currentDayNumber },
            followUps: ["Check the live situation"],
          },
          {},
          { capability: "tripSummary", status: "completed" },
        );
      }
      case "reschedule_advice": {
        const trip = working.activeTrip;
        if (!trip) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "Rescheduling needs an active trip in this conversation.",
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        if (!working.latestLiveCheck) {
          const liveCheck = await checkLiveSituation(trip, client, now);
          const count = liveCheck.situations.length;
          return finish(
            {
              ...base,
              outcome: "completed",
              capability: "checkLiveSituation",
              message:
                count > 0
                  ? `Live check found ${count} situation(s). Ask me to propose reschedule options and I will — nothing is changed yet.`
                  : "Live check found no disruptions. If plans still changed, describe what happened and ask for reschedule options.",
              data: { liveCheck },
              followUps: ["Propose reschedule options"],
            },
            { latestLiveCheck: liveCheck },
            { capability: "checkLiveSituation", status: "completed" },
          );
        }
        const proposal = await proposeReschedule(
          { trip, liveCheck: working.latestLiveCheck },
          client,
          now,
        );
        if (proposal.changes.length === 0) {
          return finish(
            {
              ...base,
              outcome: "completed",
              capability: "proposeReschedule",
              message: "No reschedulable disruptions found — your trip is unchanged.",
              data: { proposal },
              followUps: ["What's next?"],
            },
            {},
            { capability: "proposeReschedule", status: "completed" },
          );
        }
        return finish(
          {
            ...base,
            outcome: "confirmation_required",
            capability: "proposeReschedule",
            message: `I found ${proposal.changes.length} reschedule option(s). Nothing is applied yet — confirm to apply them.`,
            data: { proposal },
            followUps: [],
            confirmationRequired: {
              action: "apply_reschedule",
              summary: `Apply ${proposal.changes.length} reschedule change(s) to the active trip.`,
              requestedAt: now.toISOString(),
            },
          },
          {
            pendingConfirmation: {
              action: "apply_reschedule",
              summary: `Apply ${proposal.changes.length} reschedule change(s) to the active trip.`,
              requestedAt: now.toISOString(),
            },
          },
          { capability: "proposeReschedule", status: "proposed" },
        );
      }
      case "identify_place": {
        if (!deps.image) {
          return finish(
            {
              ...base,
              outcome: "clarification",
              capability: "none",
              message: "To identify a place, attach a photo (JPEG, PNG, or WebP) with your message.",
              followUps: [],
            },
            {},
            { capability: "none", status: "proposed" },
          );
        }
        const result = await analyzeImage({
          bytes: deps.image.bytes,
          ...(deps.image.mimeType ? { declaredMimeType: deps.image.mimeType } : {}),
        });
        const top = result.candidates[0];
        return finish(
          {
            ...base,
            outcome: "completed",
            capability: "analyzeImage",
            message:
              top != null
                ? `This looks like ${top.name} (${result.status}). Visual identification is approximate — verify before planning around it.`
                : "I could not identify this image. Try a clearer photo of the place.",
            data: { analysis: result },
            followUps: top != null ? [`Discover places near ${top.city ?? top.name}`] : [],
          },
          {},
          { capability: "analyzeImage", status: "completed" },
        );
      }
      default: {
        return finish(
          {
            intent: "needs_clarification",
            outcome: "clarification",
            capability: "none",
            message: "I don't know how to handle that yet. Ask me to plan, check, fix, or find booking options for a trip.",
            followUps: [],
          },
          {},
          { capability: "none", status: "proposed" },
        );
      }
    }
  } catch (err) {
    // Service failures become failed outcomes with the pre-turn state
    // preserved: `working` carries only the appended user entry (and any
    // pending-clearing already decided above), so no capability result is
    // ever recorded as if it succeeded.
    const failed = failedTurn(routed.intent, "none", err, []);
    return {
      ...failed,
      session: withAssistantEntry(working, failed.message, { capability: "none", status: "failed" }, now),
    };
  }
}
