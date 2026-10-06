"use client";

import { useState } from "react";
import type { TripPlanData } from "./ItineraryView";
import { formatCheckedAt, statusLabel } from "./agentChatHelpers";
import { postJson } from "./request";

/**
 * Phase 9 booking/handoff panel: readiness + live discovery +
 * external-handoff selection + final pre-trip recheck (Prompt 3).
 *
 * Shows booking readiness, then (when READY) live EXTERNAL options backed
 * by fresh SerpApi evidence, then a final verification-only recheck.
 * GhoomAI never completes a transaction:
 * - options are labeled LIVE SEARCH RESULTS vs search leads,
 * - "Continue to provider" appears only with a real returned URL,
 * - selection yields an EXTERNAL-handoff receipt, never a booking,
 * - CLEAR recheck verdict means "freshly checked", never "booked",
 * - persistent BOOKING NOT COMPLETED BY GHOOMAI notices are shown.
 */

type Readiness = "READY" | "NOT_READY" | "ALREADY_ACTIVE" | "INVALID_STATE";

interface HandoffItemData {
  itemId: string;
  kind: string;
  title: string;
  handoffEligible: boolean;
  ineligibilityReason?: string;
  searchHint?: string;
  source: { provider: string; reference: string } | null;
}

interface ReadinessData {
  readiness: Readiness;
  tripStatus: string;
  reasons: string[];
  items: HandoffItemData[];
  booking: { performed: false; bookingId: null; confirmationCode: null };
  disclaimer: string;
}

interface BookingOptionData {
  optionId: string;
  itemId: string;
  title: string;
  provider: string;
  url?: string;
  snippet?: string;
  leadType: "SEARCH_LEAD" | "CORROBORATED";
  handoffType: "EXTERNAL";
  evidence: {
    engine: string;
    observedAt: string;
    query?: string;
    placeId?: string;
    propertyToken?: string;
    sourceUrl?: string;
    purpose?: string;
    facts?: Record<string, unknown>;
  };
  observedAt: string;
}

interface ItemDiscoveryData {
  itemId: string;
  kind: string;
  title: string;
  status: "READY" | "NO_RESULTS" | "SEARCH_FAILED";
  options: BookingOptionData[];
  reason?: string;
}

interface DiscoveryData {
  tripStatus: string;
  discoveredAt: string;
  items: ItemDiscoveryData[];
  warnings: string[];
  booking: { performed: false; bookingId: null; confirmationCode: null };
  disclaimer: string;
}

interface SelectionData {
  itemId: string;
  optionId: string;
  title: string;
  provider: string;
  url: string | null;
  handoffType: "EXTERNAL";
  selectedAt: string;
  note: string;
}

type RecheckVerdict = "CLEAR" | "NEEDS_ATTENTION" | "PROBLEM" | "UNVERIFIED";

interface RecheckFinding {
  itemId: string;
  kind: string;
  title: string;
  status: string;
  reasons: string[];
}

interface RecheckedOptionData {
  itemId: string;
  optionId: string;
  title: string;
  provider: string;
  url: string | null;
  status:
    | "SUPPORTED"
    | "SUPPORTED_WITH_CHANGES"
    | "NO_LONGER_SUPPORTED"
    | "UNVERIFIED"
    | "STALE";
  reasons: string[];
  observedAt: string;
  handoffType: "EXTERNAL";
}

interface RecheckData {
  tripStatus: string;
  checkedAt: string;
  verdict: RecheckVerdict;
  summary: {
    verified: number;
    needsAttention: number;
    problem: number;
    unverified: number;
  };
  findings: RecheckFinding[];
  options: RecheckedOptionData[];
  warnings: string[];
  booking: { performed: false; bookingId: null; confirmationCode: null };
  disclaimer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDataResponse<T>(json: unknown): T | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  return json.data as unknown as T;
}

function errorMessage(json: unknown, fallback: string): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return fallback;
}

const READINESS_STYLE: Record<Readiness, string> = {
  READY: "bg-emerald-100 text-emerald-900",
  NOT_READY: "bg-amber-100 text-amber-900",
  ALREADY_ACTIVE: "bg-neutral-200 text-neutral-700",
  INVALID_STATE: "bg-red-100 text-red-900",
};

const READINESS_LABEL: Record<Readiness, string> = {
  READY: "Ready to book",
  NOT_READY: "Not ready",
  ALREADY_ACTIVE: "Already active",
  INVALID_STATE: "Invalid state",
};

const VERDICT_STYLE: Record<RecheckVerdict, string> = {
  CLEAR: "bg-emerald-100 text-emerald-900",
  NEEDS_ATTENTION: "bg-amber-100 text-amber-900",
  PROBLEM: "bg-red-100 text-red-900",
  UNVERIFIED: "bg-neutral-200 text-neutral-700",
};

const VERDICT_LABEL: Record<RecheckVerdict, string> = {
  CLEAR: "Clear — freshly checked",
  NEEDS_ATTENTION: "Needs attention",
  PROBLEM: "Problem found",
  UNVERIFIED: "Unverified",
};

export default function BookingHandoffPanel({
  plan,
  status,
}: {
  plan: TripPlanData;
  /** Current lifecycle status (DRAFT → … → APPROVED → ACTIVE → COMPLETED). */
  status: string;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadinessData | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryData | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, SelectionData>>({});
  /** Full selected option objects, resubmitted verbatim for the recheck. */
  const [selectedOptions, setSelectedOptions] = useState<Record<string, BookingOptionData>>({});
  const [rechecking, setRechecking] = useState(false);
  const [recheck, setRecheck] = useState<RecheckData | null>(null);

  // A new plan or status resets previous evaluations; readiness,
  // discovery, and recheck are always re-run explicitly, never reused.
  const signature = `${status}|${plan.destination}|${plan.days.length}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setResult(null);
    setDiscovery(null);
    setSelections({});
    setSelectedOptions({});
    setRecheck(null);
    setError(null);
  }

  async function checkReadiness() {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      const { status: http, json } = await postJson("/api/trips/booking-readiness", {
        plan,
        status,
      });
      if (http !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseDataResponse<ReadinessData>(json);
      if (!parsed) throw new Error("Unexpected readiness response. Please retry.");
      setResult(parsed);
      setDiscovery(null);
      setSelections({});
      setSelectedOptions({});
      setRecheck(null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setChecking(false);
    }
  }

  async function findOptions() {
    if (discovering) return;
    setDiscovering(true);
    setError(null);
    try {
      const { status: http, json } = await postJson("/api/trips/booking-discover", {
        plan,
        status,
      });
      if (http !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseDataResponse<DiscoveryData>(json);
      if (!parsed) throw new Error("Unexpected discovery response. Please retry.");
      setDiscovery(parsed);
      setSelections({});
      setSelectedOptions({});
      setRecheck(null);
    } catch (err) {
      setDiscovery(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setDiscovering(false);
    }
  }

  async function selectOption(itemId: string, option: BookingOptionData) {
    if (selectingId) return;
    setSelectingId(option.optionId);
    setError(null);
    try {
      const { status: http, json } = await postJson("/api/trips/booking-select", {
        plan,
        status,
        itemId,
        option,
      });
      if (http !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseDataResponse<{ selection: SelectionData }>(json);
      if (!parsed?.selection) {
        throw new Error("Unexpected selection response. Please retry.");
      }
      setSelections((prev) => ({ ...prev, [itemId]: parsed.selection }));
      setSelectedOptions((prev) => ({ ...prev, [itemId]: option }));
      setRecheck(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSelectingId(null);
    }
  }

  const eligible = result?.items.filter((i) => i.handoffEligible) ?? [];
  const ineligible = result?.items.filter((i) => !i.handoffEligible) ?? [];

  async function runRecheck() {
    if (rechecking) return;
    setRechecking(true);
    setError(null);
    try {
      const { status: http, json } = await postJson("/api/trips/booking-recheck", {
        plan,
        status,
        selections: Object.values(selectedOptions),
      });
      if (http !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseDataResponse<RecheckData>(json);
      if (!parsed) throw new Error("Unexpected recheck response. Please retry.");
      setRecheck(parsed);
    } catch (err) {
      setRecheck(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setRechecking(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold text-neutral-900">Booking &amp; handoff</h3>
      <p className="mt-1 text-sm text-neutral-600">
        GhoomAI researches and verifies — you book directly with providers.
        Approve your itinerary above first; readiness requires an approved trip.
      </p>
      <button
        type="button"
        onClick={() => void checkReadiness()}
        disabled={checking}
        className="mt-3 w-full rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {checking ? "Checking readiness…" : "Check booking readiness"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${READINESS_STYLE[result.readiness]}`}
            >
              {READINESS_LABEL[result.readiness]}
            </span>
          </p>

          {result.reasons.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {result.readiness === "READY" && (
            <div>
              <p className="text-sm font-medium text-neutral-900">
                To book or search ({eligible.length}):
              </p>
              <ul className="mt-2 space-y-2">
                {eligible.map((item) => (
                  <li
                    key={item.itemId}
                    className="rounded-xl bg-neutral-50 p-3 text-sm"
                  >
                    <p className="font-medium text-neutral-900">
                      <span className="mr-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        {statusLabel(item.kind)}
                      </span>
                      {item.title}
                    </p>
                    {item.searchHint && (
                      <p className="mt-1 text-xs text-neutral-500">
                        Search hint: {item.searchHint}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {ineligible.length > 0 && (
                <p className="mt-2 text-xs text-neutral-500">
                  {ineligible.length} informational item
                  {ineligible.length === 1 ? "" : "s"} need
                  {ineligible.length === 1 ? "s" : ""} no booking.
                </p>
              )}

              <button
                type="button"
                onClick={() => void findOptions()}
                disabled={discovering}
                className="mt-3 w-full rounded-xl bg-sky-700 px-5 py-3 font-medium text-white hover:bg-sky-600 disabled:opacity-50"
              >
                {discovering
                  ? "Searching live options…"
                  : discovery
                    ? "Refresh live options"
                    : "Find live booking options"}
              </button>
            </div>
          )}

          <p className="rounded-xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
            {result.disclaimer} No booking was made and nothing is confirmed.
          </p>
        </div>
      )}

      {discovery && (
        <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
            BOOKING NOT COMPLETED BY GHOOMAI — options below are live search
            leads for you to continue externally.
          </p>

          {discovery.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
              {discovery.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {discovery.items.map((item) => {
            const selected = selections[item.itemId];
            return (
              <div
                key={item.itemId}
                className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {statusLabel(item.kind)} · {item.status === "READY" ? "Live search results" : item.status === "NO_RESULTS" ? "No results" : "Search failed"}
                </p>
                <p className="font-medium text-neutral-900">{item.title}</p>
                {item.reason && (
                  <p className="mt-1 text-xs text-neutral-500">{item.reason}</p>
                )}
                {item.options.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {item.options.map((option) => {
                      const isSelected = selected?.optionId === option.optionId;
                      const busy = selectingId !== null;
                      return (
                        <li
                          key={option.optionId}
                          className="rounded-lg bg-white p-3 text-sm shadow-sm"
                        >
                          <p className="font-medium text-neutral-900">
                            {option.title}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            <span
                              className={`mr-2 rounded-full px-2 py-0.5 font-medium ${
                                option.leadType === "CORROBORATED"
                                  ? "bg-emerald-100 text-emerald-900"
                                  : "bg-neutral-100 text-neutral-600"
                              }`}
                            >
                              {option.leadType === "CORROBORATED"
                                ? "Corroborated"
                                : "Search lead"}
                            </span>
                            {option.provider} · observed{" "}
                            {formatCheckedAt(option.observedAt)}
                          </p>
                          {option.snippet && (
                            <p className="mt-1 text-xs text-neutral-600">
                              {option.snippet}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {option.url ? (
                              <a
                                href={option.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                              >
                                Continue to provider
                              </a>
                            ) : (
                              <p className="text-xs text-neutral-500">
                                Search lead — no direct provider page was
                                returned.
                              </p>
                            )}
                            {!isSelected ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void selectOption(item.itemId, option)}
                                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:border-neutral-500 disabled:opacity-50"
                              >
                                {selectingId === option.optionId
                                  ? "Selecting…"
                                  : "Select for handoff"}
                              </button>
                            ) : (
                              <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900">
                                Selected for external handoff
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {selected && (
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    {selected.note}
                  </p>
                )}
              </div>
            );
          })}

          <p className="rounded-xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
            {discovery.disclaimer}
          </p>
        </div>
      )}

      {result?.readiness === "READY" && (
        <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4">
          <h4 className="font-bold text-neutral-900">Final pre-trip check</h4>
          <p className="text-sm text-neutral-600">
            Freshly re-verifies the approved itinerary
            {Object.keys(selectedOptions).length > 0
              ? ` and ${Object.keys(selectedOptions).length} selected option${Object.keys(selectedOptions).length === 1 ? "" : "s"}`
              : ""}{" "}
            against live evidence. Verification only — nothing is changed or
            booked.
          </p>
          <button
            type="button"
            onClick={() => void runRecheck()}
            disabled={rechecking}
            className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {rechecking
              ? "Running final check…"
              : recheck
                ? "Re-run final pre-trip check"
                : "Run final pre-trip check"}
          </button>

          {recheck && (
            <div className="space-y-3">
              <p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${VERDICT_STYLE[recheck.verdict]}`}
                >
                  {VERDICT_LABEL[recheck.verdict]}
                </span>
              </p>
              <p className="text-xs text-neutral-500">
                Checked {formatCheckedAt(recheck.checkedAt)} ·{" "}
                {recheck.summary.verified} verified ·{" "}
                {recheck.summary.needsAttention} needing attention ·{" "}
                {recheck.summary.problem} problem ·{" "}
                {recheck.summary.unverified} unverified
              </p>

              {recheck.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
                  {recheck.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              {recheck.findings.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    What was checked ({recheck.findings.length}):
                  </p>
                  <ul className="mt-2 space-y-2">
                    {recheck.findings.map((finding) => (
                      <li
                        key={finding.itemId}
                        className="rounded-xl bg-neutral-50 p-3 text-sm"
                      >
                        <p className="font-medium text-neutral-900">
                          <span className="mr-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                            {statusLabel(finding.status)}
                          </span>
                          {finding.title}
                        </p>
                        {finding.reasons.slice(0, 2).map((reason) => (
                          <p key={reason} className="mt-1 text-xs text-neutral-600">
                            {reason}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recheck.options.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    Selected option status:
                  </p>
                  <ul className="mt-2 space-y-2">
                    {recheck.options.map((option) => (
                      <li
                        key={option.optionId}
                        className="rounded-xl bg-neutral-50 p-3 text-sm"
                      >
                        <p className="font-medium text-neutral-900">
                          <span className="mr-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                            {statusLabel(option.status)}
                          </span>
                          {option.title}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {option.provider}
                        </p>
                        {option.reasons.slice(0, 2).map((reason) => (
                          <p key={reason} className="mt-1 text-xs text-neutral-600">
                            {reason}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(recheck.verdict === "PROBLEM" ||
                recheck.verdict === "NEEDS_ATTENTION") && (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  Findings need your review — nothing was changed automatically.
                  Re-run RealityCheck above and use “Propose fixes”, then
                  approve and hand off again.
                </p>
              )}
              {recheck.verdict === "CLEAR" && (
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                  The itinerary and handoff information were freshly checked
                  against live evidence. This is not a booking — continue with
                  providers externally.
                </p>
              )}

              <p className="rounded-xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
                {recheck.disclaimer}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
