import { ConflictError, ValidationError } from "../../lib/errors";
import { checkTrip } from "../realitycheck/service";
import type { ItemCheck } from "../realitycheck/checks";
import { SerpApiClient } from "../services/serpapi/client";
import { tripPlanSchema, type TripPlan } from "../trips/plan";
import {
  buildDiscoverySearches,
  isRelevantResult,
  safeExternalUrl,
  SEARCH_RESULTS_PER_CALL,
} from "./discovery";
import { collectHandoffItems } from "./readiness";
import { validateSelection } from "./selection";
import type {
  BookingOption,
  FinalRecheckVerdict,
  RecheckedOption,
  RecheckOptionStatus,
} from "./types";
import { finalRecheckResponseSchema } from "./types";

/**
 * Phase 9 Prompt 3 pre-trip final recheck: thin orchestration around the
 * EXISTING RealityCheck engine. No second verification engine.
 *
 * Flow:
 * 1. Require APPROVED (else ConflictError). Validate plan (else
 *    ValidationError). Client lazily constructed after state validation.
 * 2. Run the existing `checkTrip` on the approved plan with its default
 *    caps/batching (MAX_VERIFICATION_ITEMS=15, deduped, per-item isolation).
 *    This is the fresh itinerary verification — observedAt = now, and no
 *    client-supplied RealityCheck is trusted.
 * 3. For each resubmitted selected option (cap MAX_RECHECK_OPTIONS):
 *    - re-validate consistency via `validateSelection` (tampered/stale →
 *      STALE, never a 400 for one bad option among good ones);
 *    - stable-ID options (placeId/propertyToken in evidence) are
 *      corroborated against the FRESH ItemChecks — zero extra SerpApi calls;
 *    - organic (web-only) options get ONE bounded google search using the
 *      item's existing discovery web query; the option is SUPPORTED only if
 *      the same normalized URL reappears among relevant results. The URL is
 *      never fetched; only search-result presence is compared.
 * 4. Derive the verdict from RealityCheck semantics. The approved plan is
 *    never mutated, the trip is never activated, nothing is booked.
 *
 * Tradeoff (documented): a full checkTrip re-verification costs the same as
 * a RealityCheck run. That is accepted because correctness beats thrift for
 * a user-initiated final gate, and all existing caps/batching still apply.
 * Option re-searches are limited to one web call per organic selected
 * option; stable-ID options cost nothing extra.
 */

export const MAX_RECHECK_OPTIONS = 10;

export const FINAL_RECHECK_DISCLAIMER =
  "Freshly checked against available live evidence just now. This is NOT a booking confirmation — no booking was made, nothing is reserved, and the approved itinerary was not changed.";

export interface FinalRecheckInput {
  plan: TripPlan;
  /** Must be APPROVED — anything else is a state conflict. */
  status: string;
  /** Resubmitted selected options from Prompt 2 discovery (stateless). */
  selections?: BookingOption[];
}

type StableRef =
  | { kind: "place"; ref: string }
  | { kind: "property"; ref: string }
  | { kind: "none"; ref: "" };

function stableRefOf(option: BookingOption): StableRef {
  if (option.evidence.placeId) return { kind: "place", ref: option.evidence.placeId };
  if (option.evidence.propertyToken) {
    return { kind: "property", ref: option.evidence.propertyToken };
  }
  return { kind: "none", ref: "" };
}

function findFreshCheck(
  findings: ItemCheck[],
  stable: { kind: "place" | "property"; ref: string },
): ItemCheck | undefined {
  return findings.find((check) =>
    stable.kind === "place"
      ? check.plannedEvidence?.placeId === stable.ref
      : check.plannedEvidence?.propertyToken === stable.ref,
  );
}

async function recheckOrganicOption(
  client: SerpApiClient,
  plan: TripPlan,
  option: BookingOption,
  itemTitle: string,
  itemKind: "stay" | "attraction" | "meal" | "note",
  observedAt: string,
  warnings: string[],
): Promise<RecheckedOption> {
  const base = {
    itemId: option.itemId,
    optionId: option.optionId,
    title: option.title,
    provider: option.provider,
    url: safeExternalUrl(option.url) ?? null,
    observedAt,
    handoffType: "EXTERNAL" as const,
  };
  const wantUrl =
    option.evidence.sourceUrl != null
      ? safeExternalUrl(option.evidence.sourceUrl)
      : base.url;
  if (!wantUrl) {
    return {
      ...base,
      status: "UNVERIFIED",
      reasons: [
        "Option carries no stable reference or evidence URL, so freshness cannot be established; treat it as an informational lead.",
      ],
    };
  }
  const searches = buildDiscoverySearches({ kind: itemKind, title: itemTitle }, plan);
  if (!searches.web) {
    return {
      ...base,
      status: "UNVERIFIED",
      reasons: ["No corroborating search is available for this option."],
    };
  }
  let results;
  try {
    const web = await client.search({
      engine: "google",
      query: searches.web.query,
      num: SEARCH_RESULTS_PER_CALL,
    });
    results = web.results;
  } catch (err) {
    warnings.push(
      `Live re-search failed for "${option.title.slice(0, 80)}"; the option is left unverified rather than marked stale.`,
    );
    return {
      ...base,
      status: "UNVERIFIED",
      reasons: [
        err instanceof Error
          ? `Fresh corroborating search failed (${err.message.slice(0, 200)}); the option is unverified, not invalid.`
          : "Fresh corroborating search failed; the option is unverified, not invalid.",
      ],
    };
  }
  const stillPresent = results.some(
    (result) =>
      isRelevantResult(itemTitle, result.title, result.snippet) &&
      result.link &&
      safeExternalUrl(result.link) === wantUrl,
  );
  if (stillPresent) {
    return {
      ...base,
      status: "SUPPORTED",
      reasons: [
        "The same provider page reappeared in a fresh live search for this item.",
      ],
    };
  }
  return {
    ...base,
    status: "NO_LONGER_SUPPORTED",
    reasons: [
      "The provider page no longer appears among fresh live search results for this item; search again before handing off.",
    ],
  };
}

async function recheckOneOption(
  client: SerpApiClient,
  plan: TripPlan,
  option: BookingOption,
  findings: ItemCheck[],
  observedAt: string,
  warnings: string[],
): Promise<RecheckedOption> {
  const staleBase = {
    itemId: option.itemId,
    optionId: option.optionId,
    title: option.title,
    provider: option.provider,
    url: safeExternalUrl(option.url) ?? null,
    observedAt,
    handoffType: "EXTERNAL" as const,
  };
  // Consistency first: tampered, swapped-URL, or otherwise invalid
  // submissions are STALE — reported, never trusted, never fatal.
  try {
    validateSelection({ plan, status: "APPROVED", itemId: option.itemId, option });
  } catch (err) {
    return {
      ...staleBase,
      status: "STALE",
      reasons: [
        err instanceof Error
          ? `Option failed validation and cannot be rechecked (${err.message.slice(0, 200)}). Please discover options again.`
          : "Option failed validation and cannot be rechecked. Please discover options again.",
      ],
    };
  }

  const stable = stableRefOf(option);
  if (stable.kind !== "none") {
    const fresh = findFreshCheck(findings, stable);
    if (!fresh) {
      return {
        ...staleBase,
        status: "UNVERIFIED",
        reasons: [
          "The fresh verification did not cover this item (e.g. beyond the verification budget), so the option cannot be corroborated.",
        ],
      };
    }
    if (fresh.status === "VERIFIED") {
      return {
        ...staleBase,
        status: "SUPPORTED",
        reasons: [
          `Fresh verification re-identified "${fresh.title.slice(0, 120)}" with status VERIFIED.`,
        ],
      };
    }
    if (fresh.status === "NEEDS_ATTENTION") {
      return {
        ...staleBase,
        status: "SUPPORTED_WITH_CHANGES",
        reasons: [
          `Fresh verification re-identified the item but flagged changes: ${fresh.reasons[0]?.slice(0, 300) ?? "see findings."}`,
        ],
      };
    }
    if (fresh.status === "PROBLEM") {
      return {
        ...staleBase,
        status: "NO_LONGER_SUPPORTED",
        reasons: [
          `Fresh verification reports a PROBLEM for this item: ${fresh.reasons[0]?.slice(0, 300) ?? "see findings."}`,
        ],
      };
    }
    return {
      ...staleBase,
      status: "UNVERIFIED",
      reasons: [
        "Fresh verification could not re-identify this item, so the option is unverified.",
      ],
    };
  }

  const item = collectHandoffItems(plan).find(
    (i) => i.itemId === option.itemId && i.handoffEligible,
  );
  if (!item || item.kind === "note") {
    return {
      ...staleBase,
      status: "STALE",
      reasons: [
        "The handoff item is no longer eligible in the submitted plan; the discovery result is stale.",
      ],
    };
  }
  return recheckOrganicOption(
    client,
    plan,
    option,
    item.title,
    item.kind,
    observedAt,
    warnings,
  );
}

function deriveVerdict(
  summary: { verified: number; needsAttention: number; problem: number; unverified: number },
  options: RecheckedOption[],
): FinalRecheckVerdict {
  const blocked = options.some((o) => o.status === "NO_LONGER_SUPPORTED");
  const attention = options.some(
    (o) =>
      o.status === "SUPPORTED_WITH_CHANGES" ||
      o.status === "UNVERIFIED" ||
      o.status === "STALE",
  );
  if (summary.problem > 0 || blocked) return "PROBLEM";
  if (summary.needsAttention > 0 || attention) return "NEEDS_ATTENTION";
  if (summary.verified === 0) return "UNVERIFIED";
  return "CLEAR";
}

/**
 * Runs the final pre-trip recheck. Verification-only: never mutates the
 * plan, never activates the trip, never books. Throws ValidationError (bad
 * plan/option shape), ConflictError (non-APPROVED), or the gateway error
 * when checkTrip itself cannot retrieve any evidence (never a fake CLEAR).
 */
export async function runFinalRecheck(
  input: FinalRecheckInput,
  client?: SerpApiClient,
  now: Date = new Date(),
) {
  const parsed = tripPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    throw new ValidationError("Invalid trip plan.");
  }
  const plan = parsed.data;
  if (input.status !== "APPROVED") {
    throw new ConflictError(
      `Final recheck requires an APPROVED trip; got ${input.status}.`,
    );
  }
  const selections = (input.selections ?? []).slice(0, MAX_RECHECK_OPTIONS);
  const warnings: string[] = [];
  if ((input.selections ?? []).length > selections.length) {
    warnings.push(
      `Only the first ${MAX_RECHECK_OPTIONS} selected options were rechecked.`,
    );
  }

  const gateway = client ?? new SerpApiClient();
  const observedAt = now.toISOString();

  // Fresh itinerary verification via the existing engine (default caps).
  const check = await checkTrip(plan, gateway, now);
  warnings.push(...check.warnings);
  if (check.items.length === 0) {
    warnings.push("The itinerary has no verifiable items; nothing was checked.");
  }

  const options: RecheckedOption[] = [];
  for (const option of selections) {
    options.push(
      await recheckOneOption(gateway, plan, option, check.items, observedAt, warnings),
    );
  }

  return finalRecheckResponseSchema.parse({
    tripStatus: input.status,
    checkedAt: observedAt,
    verdict: deriveVerdict(check.summary, options),
    summary: check.summary,
    findings: check.items,
    options,
    warnings,
    booking: { performed: false, bookingId: null, confirmationCode: null },
    disclaimer: FINAL_RECHECK_DISCLAIMER,
  });
}
