"use client";

import { useState } from "react";
import RealityCheckReport, {
  parseRealityCheckResponse,
  type RealityCheckData,
} from "./RealityCheckReport";
import type { TripPlanData } from "./ItineraryView";

/**
 * RealityCheck trigger + states for a planned trip.
 * POSTs the current TripPlan to our own /api/trips/reality-check only.
 * The browser never touches SerpApi or any API key.
 */
export default function RealityCheckSection({ plan }: { plan: TripPlanData }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RealityCheckData | null>(null);

  async function runCheck() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trips/reality-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String(
                (json as { error?: { message?: unknown } }).error?.message ??
                  "Something went wrong.",
              )
            : "Something went wrong.";
        throw new Error(message);
      }
      const parsed = parseRealityCheckResponse(json);
      if (!parsed) {
        throw new Error("Unexpected verification response. Please retry.");
      }
      setReport(parsed);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void runCheck()}
        disabled={loading}
        className="w-full rounded-xl bg-sky-700 px-5 py-3 font-medium text-white shadow-sm hover:bg-sky-600 disabled:opacity-50"
      >
        {loading
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
    </div>
  );
}
