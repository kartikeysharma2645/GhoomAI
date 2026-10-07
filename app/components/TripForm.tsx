"use client";

import { useState, type FormEvent } from "react";
import BookingHandoffPanel from "./BookingHandoffPanel";
import ItineraryView, { type TripPlanData } from "./ItineraryView";
import LiveTripView, { type LiveTripData } from "./LiveTripView";
import RealityCheckSection from "./RealityCheckSection";
import { postJson } from "./request";
import { parsePlanResponse } from "./planResult";
import { missingFieldLabel } from "./agentChatHelpers";

type ActiveTripData = LiveTripData;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(json: unknown, fallback: string): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return fallback;
}

/**
 * Stable signature identifying one planned trip. Used as a React key so
 * RealityCheck state never survives across different plans.
 */
export function planSignature(plan: TripPlanData): string {
  return [
    plan.destination,
    plan.startDate ?? "",
    plan.endDate ?? "",
    plan.durationDays,
    plan.party.adults,
    plan.party.children,
    plan.party.teenagers ?? 0,
    plan.party.seniors ?? 0,
    plan.days.length,
  ].join("|");
}

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none placeholder:text-stone-400 focus:border-teal-800";
const labelCls = "block text-sm font-medium text-stone-700";

/**
 * Compact traveler stepper. Numeric state only — no text input, so NaN
 * and negative values are unreachable; min/max are clamped on every tap.
 */
function TravelerStepper({
  id,
  label,
  ageRange,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  ageRange: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3">
      <p id={`${id}-label`} className="text-sm font-medium text-stone-900">
        {label}
      </p>
      <p className="text-xs text-stone-500">{ageRange}</p>
      <div className="mt-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300 bg-white text-lg font-medium text-stone-700 hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span
          id={id}
          role="status"
          aria-labelledby={`${id}-label`}
          className="min-w-[2ch] text-center text-base font-bold tabular-nums text-stone-900"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300 bg-white text-lg font-medium text-stone-700 hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function TripForm() {
  const [destination, setDestination] = useState("Jaipur");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [teenagers, setTeenagers] = useState(0);
  const [seniors, setSeniors] = useState(0);
  const [budget, setBudget] = useState("25000");
  const [interests, setInterests] = useState<string[]>(["history", "food"]);
  const [pace, setPace] = useState<(typeof PACES)[number]>("balanced");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInput, setNeedsInput] = useState<NeedsInput | null>(null);
  const [plan, setPlan] = useState<TripPlanData | null>(null);
  const [activeTrip, setActiveTrip] = useState<ActiveTripData | null>(null);
  const [activating, setActivating] = useState(false);
  /**
   * Explicit user approval of the itinerary. Phase 9 Prompt 1: approval is
   * the sanctioned entry into the APPROVED lifecycle state shown to the
   * booking-readiness panel. Reset whenever the plan changes.
   */
  const [approved, setApproved] = useState(false);

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
      const { status, json } = await postJson("/api/trips/plan", {
        destination: destination.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        adults,
        children,
        teenagers,
        seniors,
        budget: budget.trim()
          ? { amount: Number(budget), currency: "INR" }
          : undefined,
        interests: interests.length > 0 ? interests : undefined,
        pace,
      });
      if (status !== 200 || !isRecord(json) || json.ok !== true || !isRecord(json.data)) {
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      const data = parsePlanResponse(json.data);
      if (data.kind === "needs_input") {
        setPlan(null);
        setActiveTrip(null);
        setApproved(false);
        setNeedsInput(data.input);
      } else {
        setNeedsInput(null);
        setPlan(data.plan as unknown as TripPlanData);
        setActiveTrip(null);
        setApproved(false);
      }
    } catch (err) {
      setPlan(null);
      setActiveTrip(null);
      setApproved(false);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function startTrip() {
    if (activating || !plan) return;
    setActivating(true);
    setError(null);
    try {
      const { status, json } = await postJson("/api/trips/activate", {
        plan,
        fromStatus: "APPROVED",
      });
      if (status !== 200 || !isRecord(json) || json.ok !== true || !isRecord(json.data)) {
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      setActiveTrip(json.data as unknown as ActiveTripData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={onSubmit}
        className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div>
          <span className={labelCls}>Travelers</span>
          <div className="mt-1 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <TravelerStepper
              id="travelers-adults"
              label="Adults"
              ageRange="20–59"
              value={adults}
              min={1}
              max={16}
              onChange={setAdults}
            />
            <TravelerStepper
              id="travelers-children"
              label="Children"
              ageRange="0–12"
              value={children}
              min={0}
              max={10}
              onChange={setChildren}
            />
            <TravelerStepper
              id="travelers-teenagers"
              label="Teenagers"
              ageRange="13–19"
              value={teenagers}
              min={0}
              max={10}
              onChange={setTeenagers}
            />
            <TravelerStepper
              id="travelers-seniors"
              label="Seniors"
              ageRange="60+"
              value={seniors}
              min={0}
              max={10}
              onChange={setSeniors}
            />
          </div>
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
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 bg-white text-stone-600"
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
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 bg-white text-stone-600"
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
          className="rounded-xl bg-stone-900 px-5 py-3 font-medium text-white hover:bg-stone-700 disabled:opacity-50"
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
              Still needed: {needsInput.missing.map((m) => missingFieldLabel(m)).join(", ")}.
            </p>
          )}
        </div>
      )}

      {plan && (
        <div className="mt-8">
          <ItineraryView plan={plan} />
          <RealityCheckSection
            key={planSignature(plan)}
            plan={plan}
            onPlanReplaced={(next) => {
              setPlan(next);
              setActiveTrip(null);
              setApproved(false);
            }}
          />
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setApproved((v) => !v)}
              aria-pressed={approved}
              className={`w-full rounded-xl border px-5 py-3 font-medium ${
                approved
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "border-stone-300 bg-white text-stone-900 hover:border-stone-500"
              }`}
            >
              {approved ? "Approved ✓ (tap to revoke)" : "Approve itinerary"}
            </button>
            <p className="mt-1 text-xs text-stone-500">
              Approval is explicit and only marks the itinerary as reviewed —
              nothing is booked.
            </p>
          </div>
          <BookingHandoffPanel
            plan={plan}
            status={activeTrip ? "ACTIVE" : approved ? "APPROVED" : "PLANNED"}
          />
          {!activeTrip ? (
            <button
              type="button"
              disabled={activating}
              onClick={() => void startTrip()}
              className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
            >
              {activating ? "Starting trip…" : "Start Trip"}
            </button>
          ) : (
            <LiveTripView trip={activeTrip} onTripChange={setActiveTrip} />
          )}
        </div>
      )}
    </div>
  );
}
