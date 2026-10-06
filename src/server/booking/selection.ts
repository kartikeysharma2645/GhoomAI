import { ConflictError, ValidationError } from "../../lib/errors";
import { tripPlanSchema, type TripPlan } from "../trips/plan";
import { safeExternalUrl, toOptionId } from "./discovery";
import { collectHandoffItems } from "./readiness";
import type { BookingOption, BookingSelection } from "./types";

/**
 * Phase 9 Prompt 2 server-side selection validation (stateless).
 *
 * The user selects one discovered option per handoff item. Because GhoomAI
 * is stateless, the option is resubmitted and validated for internal
 * consistency rather than against server-held state:
 * - trip is APPROVED, item is eligible in the submitted plan
 * - option.itemId matches, optionId recomputes deterministically
 * - any URL is absolute http(s) AND identical to the option's own
 *   evidence.sourceUrl (rejects swapping an arbitrary client URL onto a
 *   legitimate option; a wholly fabricated option cannot be distinguished
 *   statelessly — documented, and the server never fetches the URL)
 * - evidence timestamp parses and is not from the future
 *
 * Returns a selection receipt that is explicitly an EXTERNAL handoff, never
 * a booking. The browser navigates via a normal user-initiated link; the
 * backend never fetches the URL.
 */

export const SELECTION_NOTE =
  "Selected for external handoff. Open the link yourself to continue with the provider; GhoomAI did not complete any booking.";

export interface ValidateSelectionInput {
  plan: TripPlan;
  status: string;
  itemId: string;
  option: BookingOption;
  now?: Date;
}

export function validateSelection(input: ValidateSelectionInput): BookingSelection {
  const parsed = tripPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    throw new ValidationError("Invalid trip plan.");
  }
  const plan = parsed.data;
  if (input.status !== "APPROVED") {
    throw new ConflictError(
      `Option selection requires an APPROVED trip; got ${input.status}.`,
    );
  }

  const item = collectHandoffItems(plan).find(
    (i) => i.itemId === input.itemId && i.handoffEligible,
  );
  if (!item) {
    throw new ValidationError(
      "Unknown or ineligible handoff item. The discovery result may be stale; please search again.",
    );
  }

  const { option } = input;
  if (option.itemId !== input.itemId) {
    throw new ValidationError(
      "Option does not belong to the selected handoff item.",
    );
  }

  // Deterministic id recomputation: the option must be internally consistent.
  const ref = (() => {
    const evidence = option.evidence;
    if (evidence.placeId) return evidence.placeId;
    if (evidence.propertyToken) return evidence.propertyToken;
    if (evidence.sourceUrl) return evidence.sourceUrl;
    return null;
  })();
  if (ref === null) {
    // Fallback refs (position-based) cannot be re-derived reliably; the
    // option id must still be well-formed and item-scoped.
    if (!option.optionId.startsWith(`${input.itemId}:`)) {
      throw new ValidationError("Option identifier is not valid for this item.");
    }
  } else if (option.optionId !== toOptionId(input.itemId, option.evidence.engine, ref)) {
    throw new ValidationError(
      "Option identifier mismatch. The discovery result may be stale; please search again.",
    );
  }

  // URL binding: a present URL must be absolute http(s) and equal to the
  // option's own evidence sourceUrl — arbitrary client URLs are rejected.
  let url: string | null = null;
  if (option.url !== undefined) {
    const safeUrl = safeExternalUrl(option.url);
    const safeEvidence = option.evidence.sourceUrl
      ? safeExternalUrl(option.evidence.sourceUrl)
      : undefined;
    if (!safeUrl || !safeEvidence || safeUrl !== safeEvidence) {
      throw new ValidationError(
        "Option URL is not a validated live-evidence destination.",
      );
    }
    url = safeUrl;
  }

  const observed = Date.parse(option.observedAt);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(observed) || observed > nowMs + 5 * 60_000) {
    throw new ValidationError("Option evidence timestamp is invalid.");
  }

  return {
    itemId: input.itemId,
    optionId: option.optionId,
    title: option.title,
    provider: option.provider,
    url,
    handoffType: "EXTERNAL",
    selectedAt: new Date(nowMs).toISOString(),
    note: SELECTION_NOTE,
  };
}
