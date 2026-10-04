"use client";

import { useState, type FormEvent } from "react";
import ItineraryView, { type TripPlanData } from "./ItineraryView";

/**
 * Trip requirements form. POSTs to our own /api/trips/plan only.
 * Handles the structured needs_input response without guessing.
 */

const ALL_INTERESTS = [
  "history",
  "food",
  "photography",
  "nature",
  "shopping",
  "nightlife",
] as const;

const PACES = ["relaxed", "balanced", "packed"] as const;

type NeedsInput = { status: "needs_input"; missing: string[]; message: string };

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-sky-600";
const labelCls = "block text-sm font-medium text-neutral-700";

export default function TripForm() {
  const [destination, setDestination] = useState("Jaipur");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [adults, setAdults] = useState("2");
  const [budget, setBudget] = useState("25000");
  const [interests, setInterests] = useState<string[]>(["history", "food"]);
  const [pace, setPace] = useState<(typeof PACES)[number]>("balanced");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInput, setNeedsInput] = useState<NeedsInput | null>(null);
  const [plan, setPlan] = useState<TripPlanData | null>(null);

  function toggleInterest(i: string) {
    setInterests((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setNeedsInput(null);
    try {
      const res = await fetch("/api/trips/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: destination.trim() || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          adults: Number(adults) || undefined,
          budget: budget.trim()
            ? { amount: Number(budget), currency: "INR" }
            : undefined,
          interests: interests.length > 0 ? interests : undefined,
          pace,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: TripPlanData | NeedsInput;
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Something went wrong.");
      }
      if ((json.data as NeedsInput).status === "needs_input") {
        setPlan(null);
        setNeedsInput(json.data as NeedsInput);
      } else {
        setNeedsInput(null);
        setPlan(json.data as TripPlanData);
      }
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={onSubmit}
        className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
      >
        <div>
          <label className={labelCls} htmlFor="destination">
            Destination
          </label>
          <input
            id="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Jaipur"
            maxLength={200}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="startDate">
              Start date
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="endDate">
              End date
            </label>
            <input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="adults">
              Adults
            </label>
            <input
              id="adults"
              type="number"
              min={1}
              max={16}
              value={adults}
              onChange={(e) => setAdults(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="budget">
              Budget (INR, optional)
            </label>
            <input
              id="budget"
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="25000"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <span className={labelCls}>Interests</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {ALL_INTERESTS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleInterest(i)}
                aria-pressed={interests.includes(i)}
                className={`rounded-full px-3 py-1 text-sm ${
                  interests.includes(i)
                    ? "bg-neutral-900 text-white"
                    : "border border-neutral-300 bg-white text-neutral-600"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={labelCls}>Pace</span>
          <div className="mt-1 flex gap-2">
            {PACES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPace(p)}
                aria-pressed={pace === p}
                className={`rounded-full px-3 py-1 text-sm capitalize ${
                  pace === p
                    ? "bg-neutral-900 text-white"
                    : "border border-neutral-300 bg-white text-neutral-600"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "Planning…" : "Plan my trip"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {needsInput && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Almost there</p>
          <p className="mt-1">{needsInput.message}</p>
          {needsInput.missing.length > 0 && (
            <p className="mt-1 text-xs">
              Missing: {needsInput.missing.join(", ")}
            </p>
          )}
        </div>
      )}

      {plan && (
        <div className="mt-8">
          <ItineraryView plan={plan} />
        </div>
      )}
    </div>
  );
}
