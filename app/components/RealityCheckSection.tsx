"use client";

import { useState } from "react";
import { postJson } from "./request";
import RealityCheckReport, {
  parseRealityCheckResponse,
  statusLabel,
  type RealityCheckData,
} from "./RealityCheckReport";
import type { TripPlanData } from "./ItineraryView";

/**
 * RealityCheck trigger + fix-proposal flow for a planned trip.
 * Talks to our own backend only: /api/trips/reality-check,
 * /api/trips/reality-fix, /api/trips/reality-fix/apply.
 * The browser never touches SerpApi or any API key.
 */

interface ProposalChange {
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

interface ProposalData {
  basedOnCheckedAt: string;
  changes: ProposalChange[];
  unchangedItemIds: string[];
  unfixable: Array<{ itemId: string; title: string; status: string; reason: string }>;
  recheckSummary: { verified: number; needsAttention: number; problem: number; unverified: number };
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProposalResponse(json: unknown): ProposalData | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const data = json.data;
  if (!Array.isArray(data.changes) || !Array.isArray(data.unfixable)) return null;
  return data as unknown as ProposalData;
}

function errorMessage(json: unknown, fallback: string): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return fallback;
}

export default function RealityCheckSection({
  plan,
  onPlanReplaced,
}: {
  plan: TripPlanData;
  onPlanReplaced: (plan: TripPlanData) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RealityCheckData | null>(null);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [keptOriginal, setKeptOriginal] = useState(false);

  async function runCheck(target: TripPlanData) {
    setChecking(true);
    setError(null);
    try {
      const { status, json } = await postJson("/api/trips/reality-check", {
        plan: target,
      });
      if (status !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseRealityCheckResponse(json);
      if (!parsed) throw new Error("Unexpected verification response. Please retry.");
      setReport(parsed);
      setProposal(null);
      setKeptOriginal(false);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setChecking(false);
    }
  }

  async function loadProposal() {
    if (proposalLoading || !report) return;
    setProposalLoading(true);
    setError(null);
    try {
      const { status, json } = await postJson("/api/trips/reality-fix", {
        plan,
        check: report,
      });
      if (status !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      const parsed = parseProposalResponse(json);
      if (!parsed) throw new Error("Unexpected proposal response. Please retry.");
      setProposal(parsed);
      setKeptOriginal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setProposalLoading(false);
    }
  }

  async function applyChanges(changeIds: string[]) {
    if (applyingId || !proposal) return;
    setApplyingId(changeIds.join(","));
    setError(null);
    try {
      const { status, json } = await postJson("/api/trips/reality-fix/apply", {
        plan,
        proposal,
        changeIds,
      });
      if (status === 409) {
        throw new Error(
          `${errorMessage(json, "Proposal is stale.")} Please re-run RealityCheck for a fresh proposal.`,
        );
      }
      if (status !== 200) throw new Error(errorMessage(json, "Something went wrong."));
      if (
        !isRecord(json) ||
        json.ok !== true ||
        !isRecord(json.data) ||
        !isRecord(json.data.plan)
      ) {
        throw new Error("Unexpected apply response. Please retry.");
      }
      const newPlan = json.data.plan as unknown as TripPlanData;
      onPlanReplaced(newPlan);
      setProposal(null);
      setReport(null);
      setKeptOriginal(false);
      await runCheck(newPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setApplyingId(null);
    }
  }

  function keepOriginal() {
    setProposal(null);
    setKeptOriginal(true);
  }

  const actionableCount =
    report?.items.filter(
      (i) => i.status === "PROBLEM" || i.status === "NEEDS_ATTENTION",
    ).length ?? 0;
  const applyableChanges =
    proposal?.changes.filter(
      (c) => c.recheck.status === "VERIFIED" || c.recheck.status === "NEEDS_ATTENTION",
    ) ?? [];

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void runCheck(plan)}
        disabled={checking}
        className="w-full rounded-xl bg-sky-700 px-5 py-3 font-medium text-white shadow-sm hover:bg-sky-600 disabled:opacity-50"
      >
        {checking
          ? "Checking against live information…"
          : report
            ? "Re-run RealityCheck"
            : "Run RealityCheck"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {report && <RealityCheckReport data={report} />}

      {report && !proposal && !keptOriginal && (
        <div className="mt-3">
          {actionableCount > 0 ? (
            <button
              type="button"
              onClick={() => void loadProposal()}
              disabled={proposalLoading}
              className="w-full rounded-xl border border-neutral-300 bg-white px-5 py-3 font-medium text-neutral-900 hover:border-neutral-500 disabled:opacity-50"
            >
              {proposalLoading ? "Finding live alternatives…" : "Propose fixes"}
            </button>
          ) : (
            <p className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              No actionable findings — nothing to fix.
            </p>
          )}
        </div>
      )}

      {proposal && (
        <div className="mt-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-neutral-900">Proposed fixes</h3>
          {proposal.changes.length === 0 && (
            <p className="text-sm text-neutral-600">
              No live alternatives could be verified right now.
            </p>
          )}
          {proposal.changes.map((change) => {
            const applyable =
              change.recheck.status === "VERIFIED" ||
              change.recheck.status === "NEEDS_ATTENTION";
            const busy = applyingId !== null;
            return (
              <div
                key={change.itemId}
                className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
              >
                <p className="text-sm text-neutral-500">
                  Replace: {change.originalTitle}
                </p>
                <p className="font-medium text-neutral-900">
                  With: {change.replacement.title}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {change.reasons.join(" · ")}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Re-check: {statusLabel(change.recheck.status)}
                </p>
                {applyable ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyChanges([change.itemId])}
                    className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {applyingId === change.itemId ? "Applying…" : "Apply Fix"}
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-neutral-500">
                    Replacement not verified — cannot apply.
                  </p>
                )}
              </div>
            );
          })}
          {applyableChanges.length > 1 && (
            <button
              type="button"
              disabled={applyingId !== null}
              onClick={() =>
                void applyChanges(applyableChanges.map((c) => c.itemId))
              }
              className="w-full rounded-xl border border-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
            >
              {applyingId ? "Applying…" : `Apply All (${applyableChanges.length})`}
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
          <button
            type="button"
            onClick={keepOriginal}
            className="w-full rounded-xl px-5 py-2.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Keep Original
          </button>
        </div>
      )}

      {keptOriginal && !proposal && (
        <p className="mt-3 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          Kept the original itinerary — nothing was changed.
        </p>
      )}
    </div>
  );
}
