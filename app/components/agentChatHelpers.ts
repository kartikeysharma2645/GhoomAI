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
