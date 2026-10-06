import { z } from "zod";
import { ValidationError } from "../../lib/errors";
import { MAX_RECHECK_OPTIONS } from "../booking/recheck";
import { MAX_DISCOVERY_ITEMS } from "../booking/discovery";
import {
  bookingOptionSchema,
  itemDiscoverySchema,
} from "../booking/types";
import { tripStatusSchema } from "../livetrip/lifecycle";
import { activeTripSchema } from "../livetrip/activeTrip";
import { liveSituationResultSchema } from "../livetrip/situation";
import { realityCheckResultSchema } from "../realitycheck/checks";
import { tripPlanRequestSchema } from "../trips/requirements";
import { tripPlanSchema } from "../trips/plan";

/**
 * Phase 10 Prompt 1 client-held conversation session contract.
 *
 * The server is and remains stateless: the client holds the session and
 * resubmits it with every turn. The session carries conversation context
 * for deterministic routing — it is NEVER an authorization mechanism.
 * A `pendingConfirmation` entry records that the user was asked to confirm
 * a consequential action; Prompt 2 execution must still validate an
 * explicit confirmation message against server-side rules. A session field
 * saying "confirmed" grants nothing by itself.
 *
 * Safety properties (all enforced by schema, never silent truncation):
 * - bounded transcript, message text, selections, and discovery data
 * - unknown fields stripped by Zod (same convention as /api/ask bodies)
 * - no secrets, no payment data — there are no fields for them
 * - oversized/malformed sessions fail validation outright
 */

export const SESSION_VERSION = 1;

/** Hard cap on stored transcript entries (user + assistant turns). */
export const MAX_TRANSCRIPT_ENTRIES = 50;
/** Hard cap on stored text per transcript entry. */
export const MAX_TRANSCRIPT_TEXT_LENGTH = 2000;
/** Maximum selected options retained (matches recheck input cap). */
export const MAX_SESSION_SELECTIONS = MAX_RECHECK_OPTIONS;
/** Maximum discovery items retained (matches discovery cap). */
export const MAX_SESSION_DISCOVERY_ITEMS = MAX_DISCOVERY_ITEMS;

/**
 * Explicit capability/action metadata attached to an assistant turn, so
 * follow-up routing reads typed state instead of parsing assistant text.
 */
export const sessionActionRefSchema = z.object({
  capability: z.string().min(1).max(50),
  status: z.enum(["proposed", "completed", "failed"]),
  /** Opaque short reference (e.g. option id, check timestamp). Never a secret. */
  ref: z.string().min(1).max(200).optional(),
});

export type SessionActionRef = z.infer<typeof sessionActionRefSchema>;

export const transcriptEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(MAX_TRANSCRIPT_TEXT_LENGTH),
  createdAt: z.string().min(1).max(100),
  action: sessionActionRefSchema.optional(),
});

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

/**
 * Approval context only. Records that a consequential action was proposed
 * and is awaiting the user's explicit confirmation turn. Carries context,
 * not authority: execution must re-validate the confirmation independently.
 */
export const pendingConfirmationSchema = z.object({
  action: z.enum([
    "activate_trip",
    "apply_fix",
    "apply_reschedule",
    "booking_select",
  ]),
  summary: z.string().min(1).max(500),
  requestedAt: z.string().min(1).max(100),
});

export type PendingConfirmation = z.infer<typeof pendingConfirmationSchema>;

export const conversationSessionSchema = z.object({
  sessionVersion: z.literal(SESSION_VERSION),
  transcript: z.array(transcriptEntrySchema).max(MAX_TRANSCRIPT_ENTRIES),
  /** The plan under discussion, when the user has created or shared one. */
  activePlan: tripPlanSchema.optional(),
  /** Lifecycle status of the active plan; DRAFT when no plan exists yet. */
  tripStatus: tripStatusSchema.default("DRAFT"),
  /** User-selected handoff options awaiting external booking. */
  selections: z.array(bookingOptionSchema).max(MAX_SESSION_SELECTIONS).optional(),
  /** Latest RealityCheck result, when the user has run one. */
  latestCheck: realityCheckResultSchema.optional(),
  /** Latest booking discovery items, enabling "use the second one" routing. */
  latestDiscovery: z.array(itemDiscoverySchema).max(MAX_SESSION_DISCOVERY_ITEMS).optional(),
  /** Active-trip snapshot, stored on activation for status/progress turns. */
  activeTrip: activeTripSchema.optional(),
  /** Latest live-situation result, basis for reschedule proposals. */
  latestLiveCheck: liveSituationResultSchema.optional(),
  /**
   * Partial trip requirements from a plan_trip turn that ended in
   * needs_input. Lets the next turn continue planning (merging newly
   * stated fields) instead of starting over. Cleared when a plan is
   * produced. Context only — every merged request is revalidated by the
   * planning capability before use.
   */
  pendingPlanRequest: tripPlanRequestSchema.optional(),
  pendingConfirmation: pendingConfirmationSchema.optional(),
});

export type ConversationSession = z.infer<typeof conversationSessionSchema>;

/** A fresh session: empty transcript, DRAFT, nothing else. Always valid. */
export function createEmptySession(): ConversationSession {
  return conversationSessionSchema.parse({
    sessionVersion: SESSION_VERSION,
    transcript: [],
    tripStatus: "DRAFT",
  });
}

export interface AppendEntryInput {
  role: "user" | "assistant";
  text: string;
  action?: SessionActionRef;
  now?: Date;
}

/**
 * Returns a new session with one transcript entry appended.
 * Throws ValidationError when the transcript cap or text limits would be
 * exceeded — callers must start/trim explicitly rather than silently
 * losing conversation meaning.
 */
export function appendTranscriptEntry(
  session: ConversationSession,
  input: AppendEntryInput,
): ConversationSession {
  const parsed = conversationSessionSchema.safeParse(session);
  if (!parsed.success) {
    throw new ValidationError("Conversation session is invalid.");
  }
  if (parsed.data.transcript.length >= MAX_TRANSCRIPT_ENTRIES) {
    throw new ValidationError(
      `Conversation transcript is full (${MAX_TRANSCRIPT_ENTRIES} entries). Start a new session to continue.`,
    );
  }
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("Transcript entry text must be non-empty.");
  }
  // Reject over-long input outright instead of keeping a silently
  // truncated entry with different meaning.
  if (text.length > MAX_TRANSCRIPT_TEXT_LENGTH) {
    throw new ValidationError(
      `Transcript entry exceeds ${MAX_TRANSCRIPT_TEXT_LENGTH} characters.`,
    );
  }
  const next: ConversationSession = {
    ...parsed.data,
    transcript: [
      ...parsed.data.transcript,
      {
        role: input.role,
        text,
        createdAt: (input.now ?? new Date()).toISOString(),
        ...(input.action ? { action: input.action } : {}),
      },
    ],
  };
  return conversationSessionSchema.parse(next);
}
