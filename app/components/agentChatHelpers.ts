"use client";

/**
 * Pure helpers for the unified agent chat UI (Phase 10 Prompt 3).
 *
 * No network, no secrets, no business logic — only mechanical translation
 * between the typed `/api/agent` turn contract and the requests the chat
 * surface sends. Consequential payloads (change IDs, proposals, options)
 * are read from the server-returned turn data verbatim; the UI never
 * invents or edits them, and the server revalidates everything.
 */

export type ConfirmAction =
  | "activate_trip"
  | "apply_fix"
  | "apply_reschedule"
  | "booking_select";

export interface ConfirmPayload {
  action: ConfirmAction;
  changeIds?: string[];
  proposal?: unknown;
  itemId?: string;
  option?: unknown;
}

export interface PendingConfirmation {
  action: ConfirmAction;
  summary: string;
  requestedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changeIdsOf(proposal: unknown): string[] | null {
  if (!isRecord(proposal)) return null;
  const changes = proposal.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const ids: string[] = [];
  for (const change of changes) {
    if (!isRecord(change) || typeof change.itemId !== "string" || !change.itemId) {
      return null;
    }
    ids.push(change.itemId);
  }
  return ids;
}

/**
 * Builds the explicit confirmation payload for a turn that returned
 * `confirmationRequired`, using only server-returned data. Returns null
 * when the turn carries no confirmation request or its data is not in the
 * expected shape — the UI must then not offer a Confirm action.
 */
export function buildConfirmPayload(turn: {
  intent: string;
  data?: unknown;
  confirmationRequired?: { action: string; summary: string; requestedAt: string };
}): ConfirmPayload | null {
  const pending = turn.confirmationRequired;
  if (!pending) return null;
  const action = asConfirmAction(pending.action);
  if (!action) return null;
  if (pending.action === "activate_trip") {
    return { action: "activate_trip" };
  }
  const data = isRecord(turn.data) ? turn.data : null;
  if (pending.action === "apply_fix" || pending.action === "apply_reschedule") {
    if (!data || !("proposal" in data)) return null;
    const ids = changeIdsOf(data.proposal);
    if (!ids) return null;
    return { action: pending.action, changeIds: ids, proposal: data.proposal };
  }
  if (pending.action === "booking_select") {
    if (!data || typeof data.itemId !== "string" || !data.itemId || !("option" in data)) {
      return null;
    }
    if (!isRecord(data.option)) return null;
    return { action: "booking_select", itemId: data.itemId, option: data.option };
  }
  return null;
}

/** Cancel payload: same action so the server can match and clear it. */
export function cancelPayload(action: ConfirmAction): ConfirmPayload {
  return { action };
}

/** Narrows an unknown action string to the confirmable set, else null. */
export function asConfirmAction(value: string): ConfirmAction | null {
  return value === "activate_trip" ||
    value === "apply_fix" ||
    value === "apply_reschedule" ||
    value === "booking_select"
    ? value
    : null;
}

/** Client-side image guard for UX only; the server remains authoritative. */
export const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 8_000_000;

export function isAcceptedImage(file: { type: string; size: number }): boolean {
  return (
    (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(file.type) &&
    file.size > 0 &&
    file.size <= MAX_IMAGE_BYTES
  );
}

/**
 * Deterministic display mappings (Phase 11 hardening).
 *
 * Server enums stay typed and unchanged; only presentation is translated
 * here so the UI never leaks implementation identifiers (`plan_trip ·
 * planTrip`, `SUPPORTED_WITH_CHANGES`, raw `startDate`) merely because the
 * API response contains them. Unknown values fall back to safe generic
 * wording, never to the raw string, except where the humanized form is
 * provably just words (statusLabel fallback).
 */

const INTENT_LABELS: Record<string, string> = {
  find_hotels: "Hotel search",
  discover_places: "Place discovery",
  general_search: "Web search",
  plan_trip: "Trip planning",
  check_trip: "Reality check",
  fix_trip: "Fix proposal",
  booking_discover: "Booking options",
  booking_select: "Booking handoff",
  booking_recheck: "Final pre-trip check",
  activate_trip: "Trip activation",
  trip_status: "Trip status",
  trip_progress: "Trip progress",
  reschedule_advice: "Rescheduling",
  identify_place: "Place identification",
  needs_clarification: "Clarification needed",
  out_of_scope: "Out of scope",
};

export function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? "GhoomAI";
}

const STATUS_LABELS: Record<string, string> = {
  VERIFIED: "Verified",
  NEEDS_ATTENTION: "Needs attention",
  PROBLEM: "Problem found",
  UNVERIFIED: "Unverified",
  CLEAR: "Clear — freshly checked",
  ATTENTION: "Needs a look",
  DISRUPTION: "Possible disruption",
  SUPPORTED: "Available",
  SUPPORTED_WITH_CHANGES: "Available with changes",
  NO_LONGER_SUPPORTED: "No longer available",
  STALE: "No longer current — please search again",
  IDENTIFIED: "Identified",
  LIKELY: "Likely match",
  UNCERTAIN: "Uncertain",
  UNIDENTIFIED: "Not identified",
  ERROR: "Unavailable",
  CORROBORATED: "Corroborated",
  SEARCH_LEAD: "Search lead",
  READY: "Ready",
  NO_RESULTS: "No results",
  SEARCH_FAILED: "Search failed",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  SKIPPED: "Skipped",
};

function humanizeEnum(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase().trim();
  if (!words || words.length > 60 || /[^a-z0-9\s\-]/.test(words)) return "Unknown status";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusLabel(status: unknown): string {
  if (typeof status !== "string" || status.length === 0) return "Unknown status";
  return STATUS_LABELS[status] ?? humanizeEnum(status);
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  destination: "destination",
  startDate: "travel start date",
  endDate: "travel end date",
  durationDays: "trip length in days",
  budget: "budget",
  booking_options: "discovered booking options",
  active_plan: "a trip plan",
  approved_plan: "an approved trip plan",
  approvable_plan: "an approved trip plan",
  active_trip: "an active trip",
  active_plan_or_trip: "an active plan or trip",
};

export function missingFieldLabel(field: string): string {
  return MISSING_FIELD_LABELS[field] ?? humanizeEnum(field).toLowerCase();
}

/** "2026-10-06T08:51:44.789Z" → "6 Oct 2026, 08:51 UTC"; garbage → "recently". */
export function formatCheckedAt(value: unknown): string {
  if (typeof value !== "string") return "recently";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "recently";
  const date = new Date(time);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getUTCMonth()] ?? "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
