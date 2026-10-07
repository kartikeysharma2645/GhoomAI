"use client";

import { useState } from "react";
import LiveSituationPanel from "./LiveSituationPanel";
import { postJson } from "./request";

/**
 * Live Trip tracker UI (Phase 6 Step 2).
 *
 * Renders the client-held ActiveTrip snapshot and posts mutations to our
 * own backend only. Viewing a day never moves the trip; only explicit
 * actions change server-validated state. No GPS, no auto-tracking.
 */

export interface LiveTripItem {
  id: string;
  kind: string;
  title: string;
  startTime?: string;
  endTime?: string;
  estimatedDurationMinutes?: number;
  place?: { name: string; address?: string; rating?: number };
}

export interface LiveTripDay {
  dayNumber: number;
  date?: string;
  items: LiveTripItem[];
}

export interface LiveTripProgressItem {
  itemId: string;
  status: "UPCOMING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
}

export interface LiveTripData {
  tripId: string;
  status: "ACTIVE" | "COMPLETED";
  activatedFrom: string;
  activatedAt: string;
  currentDayNumber: number;
  plan: {
    destination: string;
    durationDays: number;
    days: LiveTripDay[];
  };
  progress: Array<{
    dayNumber: number;
    items: LiveTripProgressItem[];
  }>;
}

const STATUS_LABEL: Record<LiveTripProgressItem["status"], string> = {
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

const STATUS_STYLE: Record<LiveTripProgressItem["status"], string> = {
  UPCOMING: "bg-teal-100 text-teal-900",
  IN_PROGRESS: "bg-amber-100 text-amber-900",
  COMPLETED: "bg-emerald-100 text-emerald-900",
  SKIPPED: "bg-stone-100 text-stone-500",
};

const KIND_LABEL: Record<string, string> = {
  attraction: "Visit",
  meal: "Meal",
  stay: "Stay",
  note: "Note",
};

/** "09:30" → "9:30 AM". Returns the input unchanged when unparseable. */
export function formatTime(value?: string): string {
  if (!value) return "";
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(json: unknown, fallback: string): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return fallback;
}

export default function LiveTripView({
  trip,
  onTripChange,
}: {
  trip: LiveTripData;
  onTripChange: (trip: LiveTripData) => void;
}) {
  const [viewedDay, setViewedDay] = useState(trip.currentDayNumber);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalDays = trip.plan.days.length;
  const viewed = trip.plan.days.find((d) => d.dayNumber === viewedDay);
  const viewedProgress = trip.progress.find((d) => d.dayNumber === viewedDay);
  const statusOf = (itemId: string) =>
    viewedProgress?.items.find((i) => i.itemId === itemId)?.status ?? "UPCOMING";

  const counts = { completed: 0, skipped: 0, remaining: 0, total: 0 };
  for (const day of trip.progress) {
    const planDay = trip.plan.days.find((d) => d.dayNumber === day.dayNumber);
    for (const entry of day.items) {
      const kind = planDay?.items.find((i) => i.id === entry.itemId)?.kind;
      if (kind === "note") continue;
      counts.total += 1;
      if (entry.status === "COMPLETED") counts.completed += 1;
      else if (entry.status === "SKIPPED") counts.skipped += 1;
      else counts.remaining += 1;
    }
  }

  async function mutate(
    key: string,
    url: string,
    body: unknown,
    apply: (data: LiveTripData) => void,
  ) {
    if (pendingKey) return;
    setPendingKey(key);
    setError(null);
    try {
      const { status, json } = await postJson(url, body);
      if (status !== 200) throw new Error(responseError(json, "Something went wrong."));
      if (
        !isRecord(json) ||
        json.ok !== true ||
        !isRecord(json.data) ||
        !Array.isArray((json.data as { progress?: unknown }).progress)
      ) {
        throw new Error("Unexpected response. Please retry.");
      }
      apply(json.data as unknown as LiveTripData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setPendingKey(null);
    }
  }

  function changeStatus(itemId: string, toStatus: LiveTripProgressItem["status"]) {
    void mutate(`item:${itemId}:${toStatus}`, "/api/trips/active/progress", {
      trip,
      dayNumber: viewedDay,
      itemId,
      toStatus,
    }, onTripChange);
  }

  function changeDay(dayNumber: number) {
    void mutate(`day:${dayNumber}`, "/api/trips/active/day", {
      trip,
      dayNumber,
    }, onTripChange);
  }

  function completeTrip() {
    void mutate("trip:complete", "/api/trips/active/complete", { trip }, onTripChange);
  }

  const isActive = trip.status === "ACTIVE";
  const canComplete = isActive && counts.remaining === 0 && counts.total > 0;

  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
          Live Trip
        </p>
        <h3 className="mt-1 text-2xl font-bold text-stone-900">
          {trip.plan.destination} · Day {trip.currentDayNumber} of {totalDays}
        </h3>
        <p className="mt-1 text-sm text-stone-600">
          Completed: {counts.completed} / {counts.total}
          {" · "}Skipped: {counts.skipped}
          {" · "}Remaining: {counts.remaining}
        </p>
        {trip.status === "COMPLETED" && (
          <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900">
            Trip completed. Thanks for traveling with GhoomAI.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={viewedDay <= 1}
          onClick={() => setViewedDay((d) => Math.max(1, d - 1))}
          className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          ← Prev day
        </button>
        <p className="text-sm text-stone-600">
          Viewing Day {viewedDay}
          {viewedDay !== trip.currentDayNumber &&
            ` (trip is on Day ${trip.currentDayNumber})`}
        </p>
        <button
          type="button"
          disabled={viewedDay >= totalDays}
          onClick={() => setViewedDay((d) => Math.min(totalDays, d + 1))}
          className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          Next day →
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <ol className="space-y-3">
        {(!viewed || viewed.items.length === 0) && (
          <li className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">
            No activities scheduled for this day.
          </li>
        )}
        {viewed?.items.map((item) => {
          const status = statusOf(item.id);
          const busy = pendingKey !== null;
          const itemKey = (action: string) => `item:${item.id}:${action}`;
          return (
            <li
              key={item.id}
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
                >
                  {STATUS_LABEL[status]}
                </span>
                <span className="text-xs text-stone-500">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                {(item.startTime || item.endTime) && (
                  <span className="text-xs text-stone-500">
                    {formatTime(item.startTime)}
                    {item.startTime && item.endTime ? "–" : ""}
                    {formatTime(item.endTime)}
                  </span>
                )}
              </div>
              <p className="mt-1 font-medium text-stone-900">{item.title}</p>
              {item.place?.address && (
                <p className="text-sm text-stone-600">{item.place.address}</p>
              )}
              {typeof item.place?.rating === "number" && (
                <p className="text-sm text-amber-700">
                  {item.place.rating.toFixed(1)}
                </p>
              )}
              {isActive && status === "UPCOMING" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus(item.id, "IN_PROGRESS")}
                  className="mt-2 w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 sm:w-auto"
                >
                  {pendingKey === itemKey("IN_PROGRESS") ? "Starting…" : "Start"}
                </button>
              )}
              {isActive && status === "IN_PROGRESS" && (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(item.id, "COMPLETED")}
                    className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {pendingKey === itemKey("COMPLETED") ? "Saving…" : "Complete"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(item.id, "SKIPPED")}
                    className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:border-stone-500 disabled:opacity-50"
                  >
                    {pendingKey === itemKey("SKIPPED") ? "Saving…" : "Skip"}
                  </button>
                </div>
              )}
              {isActive && status === "UPCOMING" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus(item.id, "SKIPPED")}
                  className="mt-2 w-full rounded-lg px-4 py-1.5 text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-50 sm:w-auto"
                >
                  Skip
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {isActive && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={pendingKey !== null || viewedDay === trip.currentDayNumber}
            onClick={() => changeDay(viewedDay)}
            className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {pendingKey === `day:${viewedDay}` ? "Moving…" : `Set current day to Day ${viewedDay}`}
          </button>
          <button
            type="button"
            disabled={pendingKey !== null || !canComplete}
            onClick={completeTrip}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            title={
              canComplete
                ? "Finish the trip"
                : "Complete or skip every activity first"
            }
          >
            {pendingKey === "trip:complete" ? "Completing…" : "Complete Trip"}
          </button>
        </div>
      )}
      {isActive && !canComplete && (
        <p className="text-xs text-stone-500">
          Complete or skip every activity to finish the trip.
        </p>
      )}

      {isActive && (
        <LiveSituationPanel
          trip={trip}
          onTripChange={(next) => {
            onTripChange(next);
          }}
        />
      )}
    </section>
  );
}
