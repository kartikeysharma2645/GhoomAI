"use client";

import { useState } from "react";
import RealityCheckReport, {
  parseRealityCheckResponse,
  type RealityCheckData,
} from "./RealityCheckReport";
import type { LiveTripData } from "./LiveTripView";
import { postJson } from "./request";

/**
 * Live situation panel (Phase 7 Step 1).
 *
 * Runs a bounded live situation check against the current ActiveTrip
 * snapshot and reports what changed. Detection only — the itinerary is
 * never modified here. Talks to our own backend only.
 */

export type SituationStatus = "CLEAR" | "ATTENTION" | "DISRUPTION" | "UNVERIFIED";

export interface SituationData {
  situationId: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  confidence: string;
  evidence: {
    engine: string;
    query: string;
    observedAt: string;
    sourceUrl?: string;
  };
  affectedItemIds: string[];
  recommendedAction: string;
}

export interface LiveSituationData {
  checkedAt: string;
  destination: string;
  status: string;
  situations: SituationData[];
  checkedItemIds: string[];
  affectedItemIds: string[];
  queriesUsed: string[];
  warnings: string[];
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "CLEAR",
  "ATTENTION",
  "DISRUPTION",
  "UNVERIFIED",
]);

const STATUS_LABEL: Record<SituationStatus, string> = {
  CLEAR: "All clear",
  ATTENTION: "Needs a look",
  DISRUPTION: "Possible disruption",
  UNVERIFIED: "Could not check",
};

const STATUS_STYLE: Record<SituationStatus, string> = {
  CLEAR: "bg-emerald-100 text-emerald-900",
  ATTENTION: "bg-amber-100 text-amber-900",
  DISRUPTION: "bg-red-100 text-red-900",
  UNVERIFIED: "bg-neutral-100 text-neutral-600",
};

const STATUS_COPY: Record<SituationStatus, string> = {
  CLEAR: "Live information supports continuing as planned.",
  ATTENTION: "Something changed or is uncertain — review before you go.",
  DISRUPTION: "Strong live evidence indicates trouble — review affected items.",
  UNVERIFIED: "Not enough live information to check right now.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSituationResponse(json: unknown): LiveSituationData | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const data = json.data;
  if (
    typeof data.checkedAt !== "string" ||
    typeof data.status !== "string" ||
    !Array.isArray(data.situations) ||
    !Array.isArray(data.affectedItemIds)
  ) {
    return null;
  }
  return data as unknown as LiveSituationData;
}

export function formatCheckedAt(checkedAt: string): string | null {
  if (!checkedAt) return null;
  const time = new Date(checkedAt).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleString();
}

export interface ProposalChange {
  itemId: string;
  dayNumber: number;
  action: string;
  originalTitle: string;
  originalFinding: { status: string; summary: string };
  replacement: { id: string; kind: string; title: string };
  candidatesConsidered: number;
  reasons: string[];
  recheck: { status: string; reasons: string[] };
}

export interface RescheduleProposal {
  basedOnCheckedAt: string;
  situationIds: string[];
  changes: ProposalChange[];
  unchangedItemIds: string[];
  unfixable: Array<{ itemId: string; title: string; reason: string }>;
  recheckSummary: { verified: number; needsAttention: number; problem: number; unverified: number };
  warnings: string[];
}

const ACTIONABLE_SITUATION_TYPES: ReadonlySet<string> = new Set([
  "CLOSED",
  "TEMPORARILY_CLOSED",
  "SCHEDULE_CHANGE",
]);

export function hasActionableSituations(result: LiveSituationData): boolean {
  return result.situations.some((s) => ACTIONABLE_SITUATION_TYPES.has(s.type));
}

export function parseProposalResponse(json: unknown): RescheduleProposal | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const data = json.data;
  if (
    typeof data.basedOnCheckedAt !== "string" ||
    !Array.isArray(data.changes) ||
    !Array.isArray(data.unfixable)
  ) {
    return null;
  }
  return data as unknown as RescheduleProposal;
}

function titleOf(trip: LiveTripData, itemId: string): string {
  for (const day of trip.plan.days) {
    const found = day.items.find((i) => i.id === itemId);
    if (found) return found.title;
  }
  return itemId;
}

export default function LiveSituationPanel({
  trip,
  onTripChange,
}: {
  trip: LiveTripData;
  onTripChange: (trip: LiveTripData) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LiveSituationData | null>(null);
  const [proposal, setProposal] = useState<RescheduleProposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [freshCheck, setFreshCheck] = useState<RealityCheckData | null>(null);
  const [freshCheckLoading, setFreshCheckLoading] = useState(false);

  async function runCheck() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { status: httpStatus, json } = await postJson(
        "/api/trips/active/live-check",
        { trip },
      );
      if (httpStatus !== 200) {
        const message =
          isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
            ? json.error.message
            : "Something went wrong.";
        throw new Error(message);
      }
      const parsed = parseSituationResponse(json);
      if (!parsed) throw new Error("Unexpected response. Please retry.");
      setResult(parsed);
      setProposal(null);
      setSelectedIds([]);
      setFreshCheck(null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadProposal() {
    if (proposalLoading || !result) return;
    setProposalLoading(true);
    setError(null);
    try {
      const { status: httpStatus, json } = await postJson(
        "/api/trips/active/reschedule",
        { trip, liveCheck: result },
      );
      if (httpStatus !== 200) {
        const message =
          isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
            ? json.error.message
            : "Something went wrong.";
        throw new Error(message);
      }
      const parsed = parseProposalResponse(json);
      if (!parsed) throw new Error("Unexpected response. Please retry.");
      setProposal(parsed);
      setSelectedIds(
        parsed.changes
          .filter(
            (c) => c.recheck.status === "VERIFIED" || c.recheck.status === "NEEDS_ATTENTION",
          )
          .map((c) => c.itemId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setProposalLoading(false);
    }
  }

  function toggleSelected(itemId: string) {
    setSelectedIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  }

  function keepOriginal() {
    setProposal(null);
    setSelectedIds([]);
    setFreshCheck(null);
  }

  async function applyChanges(changeIds: string[]) {
    if (applying || changeIds.length === 0 || !proposal) return;
    setApplying(true);
    setError(null);
    try {
      const { status: httpStatus, json } = await postJson(
        "/api/trips/active/reschedule/apply",
        { trip, proposal, changeIds },
      );
      if (httpStatus === 409) {
        const message =
          isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
            ? json.error.message
            : "Proposal is stale.";
        throw new Error(
          `${message} Please run a fresh live check for a new proposal.`,
        );
      }
      if (httpStatus !== 200) {
        const message =
          isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
            ? json.error.message
            : "Something went wrong.";
        throw new Error(message);
      }
      if (
        !isRecord(json) ||
        json.ok !== true ||
        !isRecord(json.data) ||
        !isRecord(json.data.trip)
      ) {
        throw new Error("Unexpected response. Please retry.");
      }
      const newTrip = json.data.trip as unknown as LiveTripData;
      onTripChange(newTrip);
      setProposal(null);
      setSelectedIds([]);
      setResult(null);
      await runFreshCheck(newTrip);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setApplying(false);
    }
  }

  async function runFreshCheck(target: LiveTripData) {
    setFreshCheckLoading(true);
    try {
      const { status: httpStatus, json } = await postJson(
        "/api/trips/reality-check",
        { plan: target.plan },
      );
      if (httpStatus !== 200) return;
      const parsed = parseRealityCheckResponse(json);
      if (parsed) setFreshCheck(parsed);
    } catch {
      // Fresh verification is best-effort; the updated trip stands regardless.
    } finally {
      setFreshCheckLoading(false);
    }
  }

  const status = (result?.status ?? null) as SituationStatus | null;
  const known = status && KNOWN_STATUSES.has(status) ? status : null;
  const checkedAt = result ? formatCheckedAt(result.checkedAt) : null;
  const hasDisruption = result?.status === "DISRUPTION";

  return (
    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-bold text-neutral-900">Live conditions</h4>
          <p className="text-xs text-neutral-500">
            Checks upcoming places against live information. Nothing is changed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={loading}
          className="shrink-0 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {loading ? "Checking live…" : result ? "Re-check live" : "Check Live Conditions"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                known ? STATUS_STYLE[known] : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {known ? STATUS_LABEL[known] : result.status}
            </span>
            {checkedAt && (
              <span className="text-xs text-neutral-500">
                Live check · {checkedAt}
              </span>
            )}
          </div>
          {known && (
            <p className="text-sm text-neutral-600">{STATUS_COPY[known]}</p>
          )}
          {hasDisruption && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
            >
              Your itinerary may be affected. Review the items below — nothing
              has been rescheduled.
            </p>
          )}
          {result.situations.length === 0 ? (
            <p className="text-sm text-neutral-600">
              No concerning signals in this check.
            </p>
          ) : (
            <ol className="space-y-2">
              {result.situations.map((s) => (
                <li
                  key={s.situationId}
                  className="rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <p className="font-medium text-neutral-900">{s.title}</p>
                  <p className="mt-0.5 text-sm text-neutral-600">{s.description}</p>
                  {s.affectedItemIds.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-500">
                      Affects:{" "}
                      {s.affectedItemIds.map((id) => titleOf(trip, id)).join(" · ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">
                    Source: {s.evidence.engine === "google_maps" ? "Google Maps" : "Google Search"}
                    {" · confidence "}{s.confidence}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {hasActionableSituations(result) && !proposal && (
            <button
              type="button"
              onClick={() => void loadProposal()}
              disabled={proposalLoading}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:border-neutral-500 disabled:opacity-50"
            >
              {proposalLoading ? "Finding live alternatives…" : "Find alternatives"}
            </button>
          )}
          {proposal && (
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
              <p className="text-sm font-medium text-neutral-900">
                Proposed changes
              </p>
              <p className="text-xs text-neutral-500">
                This is a proposed change. Your itinerary has not been changed.
              </p>
              {proposal.changes.length === 0 && (
                <p className="text-sm text-neutral-600">
                  No safe alternative could be verified right now.
                </p>
              )}
              {proposal.changes.map((change) => {
                const checked = selectedIds.includes(change.itemId);
                const verified =
                  change.recheck.status === "VERIFIED" ||
                  change.recheck.status === "NEEDS_ATTENTION";
                return (
                  <div
                    key={change.itemId}
                    className="rounded-lg bg-neutral-50/60 p-2.5"
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!verified || applying}
                        onChange={() => toggleSelected(change.itemId)}
                        aria-label={`Select fix for ${change.originalTitle}`}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm text-neutral-500">
                          Replace: {change.originalTitle}
                        </span>
                        <span className="block font-medium text-neutral-900">
                          With: {change.replacement.title}
                        </span>
                      </span>
                    </label>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {change.reasons.join(" · ")}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Re-check: {change.recheck.status}
                    </p>
                    {verified ? (
                      <button
                        type="button"
                        disabled={applying}
                        onClick={() => void applyChanges([change.itemId])}
                        className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {applying ? "Applying…" : "Apply Change"}
                      </button>
                    ) : (
                      <p className="mt-1 text-xs text-neutral-500">
                        Replacement not verified — cannot apply.
                      </p>
                    )}
                  </div>
                );
              })}
              {proposal.changes.length > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={applying || selectedIds.length === 0}
                    onClick={() => void applyChanges(selectedIds)}
                    className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                  >
                    {applying
                      ? "Applying…"
                      : `Apply Selected (${selectedIds.length})`}
                  </button>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={keepOriginal}
                    className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
                  >
                    Keep Original
                  </button>
                </div>
              )}
              {proposal.changes.length === 0 && (
                <button
                  type="button"
                  onClick={keepOriginal}
                  className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:border-neutral-500"
                >
                  Keep Original
                </button>
              )}
              {proposal.unfixable.length > 0 && (
                <div className="text-sm text-neutral-600">
                  <p className="font-medium">Could not fix:</p>
                  <ul className="list-disc pl-5">
                    {proposal.unfixable.map((u) => (
                      <li key={u.itemId}>
                        {u.title} — {u.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
                  {proposal.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {freshCheckLoading && (
            <p className="text-sm text-neutral-500">
              Re-verifying the updated itinerary against live information…
            </p>
          )}
        </div>
      )}
      {freshCheck && (
        <div className="mt-3">
          <RealityCheckReport data={freshCheck} />
        </div>
      )}
    </div>
  );
}
