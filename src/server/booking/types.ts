import { z } from "zod";
import { itemCheckSchema } from "../realitycheck/checks";
import { evidenceSchema } from "../trips/plan";

/**
 * Phase 9 Prompt 1 booking & handoff domain model.
 *
 * Provider-agnostic contract distinguishing:
 * - discovery/search result  (a future live finding; NOT present in Prompt 1)
 * - handoff destination       (represented only as a deterministic searchHint;
 *                              no URLs are fabricated — live discovery in a later
 *                              prompt fills `source` from real evidence)
 * - user-selected option      (not modeled yet — no selection UI in Prompt 1)
 * - external booking          (performed by the user, outside GhoomAI)
 * - confirmed booking         (NEVER claimed: `booking.performed` is always
 *                              false and confirmation fields are always null)
 *
 * Rules:
 * - No prices, availability, URLs, booking IDs, or confirmation codes anywhere.
 * - `source` is always null in Prompt 1; it exists so later live-search work
 *   has a typed slot backed by real SerpApi evidence.
 */

export const BOOKING_READINESS_STATES = [
  "READY",
  "NOT_READY",
  "ALREADY_ACTIVE",
  "INVALID_STATE",
] as const;

export type BookingReadiness = (typeof BOOKING_READINESS_STATES)[number];

export const bookingReadinessSchema = z.enum(BOOKING_READINESS_STATES);

/** Kinds of itinerary needs, mirroring the itinerary model. Only stay, attraction, and meal are ever handoff-eligible; note items are always ineligible. */
export const HANDOFF_ITEM_KINDS = ["stay", "attraction", "meal", "note"] as const;

export type HandoffItemKind = (typeof HANDOFF_ITEM_KINDS)[number];

/**
 * Provider/source metadata, populated only from live discovery evidence.
 * Always null in Prompt 1 — never fabricated.
 */
export const handoffSourceSchema = z.object({
  provider: z.string().min(1).max(100),
  /** Opaque provider reference returned by live evidence (never invented). */
  reference: z.string().min(1).max(300),
});

export type HandoffSource = z.infer<typeof handoffSourceSchema>;

export const handoffItemSchema = z.object({
  itemId: z.string().min(1).max(100),
  kind: z.enum(HANDOFF_ITEM_KINDS),
  title: z.string().min(1).max(300),
  /** Whether this item is eligible for external handoff. */
  handoffEligible: z.boolean(),
  /** Set when handoffEligible is false; explains why. */
  ineligibilityReason: z.string().max(500).optional(),
  /**
   * Deterministic search hint ("<title>, <destination>") for future live
   * discovery. A query string, not a destination URL — no link is implied.
   */
  searchHint: z.string().min(1).max(300).optional(),
  /** Live provider/source metadata; always null until live discovery lands. */
  source: handoffSourceSchema.nullable(),
});

export type HandoffItem = z.infer<typeof handoffItemSchema>;

/**
 * Booking record. Prompt 1 never performs a booking: `performed` is always
 * false and both confirmation fields are always null. This makes a fake
 * booking confirmation structurally unrepresentable.
 */
export const bookingRecordSchema = z.object({
  performed: z.literal(false),
  bookingId: z.null(),
  confirmationCode: z.null(),
});

export type BookingRecord = z.infer<typeof bookingRecordSchema>;

export const bookingReadinessResponseSchema = z.object({
  readiness: bookingReadinessSchema,
  /** Echo of the evaluated lifecycle status (or the unknown value received). */
  tripStatus: z.string().min(1).max(50),
  /** Blocking reasons; empty when READY. */
  reasons: z.array(z.string().max(500)),
  /** What needs to be booked/searched, with per-item handoff eligibility. */
  items: z.array(handoffItemSchema),
  booking: bookingRecordSchema,
  disclaimer: z.string().min(1).max(500),
});

export type BookingReadinessResponse = z.infer<
  typeof bookingReadinessResponseSchema
>;

/**
 * Phase 9 Prompt 2 live-discovery extensions (additive — Prompt 1 unchanged).
 *
 * - BookingOption: one normalized, provider-neutral external option.
 *   URLs appear ONLY when returned by live evidence (organic `link` or Maps
 *   `links.website`), validated to absolute http(s). Prices, availability,
 *   booking IDs, and confirmation codes have NO fields anywhere by design.
 * - leadType distinguishes CORROBORATED (stable-ID re-identification or
 *   cross-engine agreement on fresh results) from SEARCH_LEAD.
 * - handoffType is always "EXTERNAL": the UI can never render an option as
 *   a completed booking.
 */

export const BOOKING_LEAD_TYPES = ["SEARCH_LEAD", "CORROBORATED"] as const;

export type BookingLeadType = (typeof BOOKING_LEAD_TYPES)[number];

export const bookingOptionSchema = z.object({
  /** Stable deterministic id: `${itemId}:${engine}:${ref}` (never random). */
  optionId: z.string().min(1).max(160),
  itemId: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  /** Source label (e.g. hostname, "Google Maps", "Google Hotels"). */
  provider: z.string().min(1).max(100),
  /**
   * Absolute http(s) URL from live evidence only. Absent when the provider
   * returned none — the UI then renders a search lead with no CTA.
   */
  url: z.string().min(1).max(2000).optional(),
  snippet: z.string().max(500).optional(),
  leadType: z.enum(BOOKING_LEAD_TYPES),
  handoffType: z.literal("EXTERNAL"),
  evidence: evidenceSchema,
  observedAt: z.string().min(1).max(100),
});

export type BookingOption = z.infer<typeof bookingOptionSchema>;

export const ITEM_DISCOVERY_STATUSES = [
  "READY",
  "NO_RESULTS",
  "SEARCH_FAILED",
] as const;

export type ItemDiscoveryStatus = (typeof ITEM_DISCOVERY_STATUSES)[number];

export const itemDiscoverySchema = z.object({
  itemId: z.string().min(1).max(100),
  kind: z.enum(HANDOFF_ITEM_KINDS),
  title: z.string().min(1).max(300),
  status: z.enum(ITEM_DISCOVERY_STATUSES),
  /** Corroborated options first; at most MAX_OPTIONS_PER_ITEM. */
  options: z.array(bookingOptionSchema),
  /** Set for NO_RESULTS / SEARCH_FAILED; explains why honestly. */
  reason: z.string().max(500).optional(),
});

export type ItemDiscovery = z.infer<typeof itemDiscoverySchema>;

export const bookingDiscoveryResponseSchema = z.object({
  tripStatus: z.string().min(1).max(50),
  discoveredAt: z.string().min(1).max(100),
  items: z.array(itemDiscoverySchema),
  warnings: z.array(z.string().max(500)),
  booking: bookingRecordSchema,
  disclaimer: z.string().min(1).max(500),
});

export type BookingDiscoveryResponse = z.infer<
  typeof bookingDiscoveryResponseSchema
>;

/**
 * Explicit user selection of one discovered option for external handoff.
 * A receipt, never a booking: `booking` reuses the never-performed record,
 * and `note` states plainly that the user must continue externally.
 */
export const bookingSelectionSchema = z.object({
  itemId: z.string().min(1).max(100),
  optionId: z.string().min(1).max(160),
  title: z.string().min(1).max(300),
  provider: z.string().min(1).max(100),
  /** The validated external URL, or null when the option has none. */
  url: z.string().min(1).max(2000).nullable(),
  handoffType: z.literal("EXTERNAL"),
  selectedAt: z.string().min(1).max(100),
  note: z.string().min(1).max(500),
});

export type BookingSelection = z.infer<typeof bookingSelectionSchema>;

export const bookingSelectResponseSchema = z.object({
  selection: bookingSelectionSchema,
  booking: bookingRecordSchema,
  disclaimer: z.string().min(1).max(500),
});

export type BookingSelectResponse = z.infer<typeof bookingSelectResponseSchema>;

/**
 * Phase 9 Prompt 3 pre-trip final recheck extensions (additive).
 *
 * The recheck is verification-only around the EXISTING RealityCheck engine:
 * - verdict reuses RealityCheck semantics (CLEAR ≈ verified, NEEDS_ATTENTION,
 *   PROBLEM, UNVERIFIED). It means "freshly checked", NEVER "booked".
 * - findings embeds the fresh checkTrip ItemChecks verbatim (no new engine).
 * - each resubmitted selected option gets a freshness status against fresh
 *   evidence: SUPPORTED / SUPPORTED_WITH_CHANGES / NO_LONGER_SUPPORTED /
 *   UNVERIFIED / STALE. No URLs are fetched; organic options are rechecked
 *   with one bounded live search, stable-ID options against fresh ItemChecks.
 * - booking reuses the never-performed record: a CLEAR recheck must be
 *   structurally incapable of reading as a booking confirmation.
 */

export const FINAL_RECHECK_VERDICTS = [
  "CLEAR",
  "NEEDS_ATTENTION",
  "PROBLEM",
  "UNVERIFIED",
] as const;

export type FinalRecheckVerdict = (typeof FINAL_RECHECK_VERDICTS)[number];

export const RECHECK_OPTION_STATUSES = [
  "SUPPORTED",
  "SUPPORTED_WITH_CHANGES",
  "NO_LONGER_SUPPORTED",
  "UNVERIFIED",
  "STALE",
] as const;

export type RecheckOptionStatus = (typeof RECHECK_OPTION_STATUSES)[number];

export const recheckedOptionSchema = z.object({
  itemId: z.string().min(1).max(100),
  optionId: z.string().min(1).max(160),
  title: z.string().min(1).max(300),
  provider: z.string().min(1).max(100),
  /** Echo of the validated submitted URL, or null. Never fetched. */
  url: z.string().max(2000).nullable(),
  status: z.enum(RECHECK_OPTION_STATUSES),
  reasons: z.array(z.string().max(500)),
  /** Fresh recheck timestamp (not the option's original observedAt). */
  observedAt: z.string().min(1).max(100),
  handoffType: z.literal("EXTERNAL"),
});

export type RecheckedOption = z.infer<typeof recheckedOptionSchema>;

export const finalRecheckResponseSchema = z.object({
  tripStatus: z.string().min(1).max(50),
  checkedAt: z.string().min(1).max(100),
  verdict: z.enum(FINAL_RECHECK_VERDICTS),
  summary: z.object({
    verified: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    problem: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  /** Fresh checkTrip ItemChecks verbatim — what was checked, per item. */
  findings: z.array(itemCheckSchema),
  /** Freshness of each resubmitted selected option (empty when none). */
  options: z.array(recheckedOptionSchema),
  warnings: z.array(z.string().max(500)),
  booking: bookingRecordSchema,
  disclaimer: z.string().min(1).max(500),
});

export type FinalRecheckResponse = z.infer<typeof finalRecheckResponseSchema>;
