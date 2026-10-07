/**
 * Trip plan display for the Phase 4 planner UI.
 * Renders the server-built TripPlan only — assumptions, warnings, cost
 * bases, and evidence counts are shown as returned, never reinterpreted.
 */

import React from "react";
import { externalPlaceUrl } from "./agentChatHelpers";
import ExternalLink from "./ExternalLink";

export interface PlanEvidence {
  engine: string;
  observedAt: string;
  placeId?: string;
  propertyToken?: string;
  sourceUrl?: string;
  query?: string;
  purpose?: string;
  currency?: string;
  facts: {
    rating?: number;
    reviews?: number;
    address?: string;
    openState?: string;
  };
}

export interface TripParty {
  adults: number;
  children: number;
  teenagers?: number;
  seniors?: number;
}

/**
 * Human-readable traveler summary (2 adults · 2 children · 1 teenager).
 * Zero-value categories are omitted; with only adults it stays "2 adults".
 * Missing teen/senior fields (older plans) read as zero.
 */
export function formatPartyLabel(party: TripParty): string {
  const parts = [
    `${party.adults} adult${party.adults === 1 ? "" : "s"}`,
  ];
  const children = party.children;
  if (children > 0) parts.push(`${children} child${children === 1 ? "" : "ren"}`);
  const teenagers = party.teenagers ?? 0;
  if (teenagers > 0) parts.push(`${teenagers} teenager${teenagers === 1 ? "" : "s"}`);
  const seniors = party.seniors ?? 0;
  if (seniors > 0) parts.push(`${seniors} senior${seniors === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export interface PlanItem {
  id: string;
  kind: "attraction" | "meal" | "stay" | "note";
  title: string;
  startTime?: string;
  endTime?: string;
  estimatedDurationMinutes?: number;
  place?: { name: string; address?: string; rating?: number };
  evidence: PlanEvidence[];
  cost?: { label: string; amount?: number; currency: string; basis: string };
  notes?: string;
  selectionReasons?: string[];
}

export interface PlanDay {
  dayNumber: number;
  date?: string;
  items: PlanItem[];
}

export interface TripPlanData {
  destination: string;
  dateMode: "fixed" | "flexible";
  startDate?: string;
  endDate?: string;
  durationDays: number;
  party: TripParty;
  budget?: { amount: number; currency: string };
  budgetVerdict: "within" | "exceeds_live_costs" | "unknown";
  assumptions: string[];
  warnings: string[];
  stay?: {
    hotelName: string;
    nights: number;
    nightlyLowest?: string;
    total?: { label: string; amount?: number; currency: string; basis: string };
  };
  days: PlanDay[];
  destinationContext?: {
    summary: string[];
    sources: Array<{ title: string; link: string }>;
  };
  totals: {
    lines: Array<{
      label: string;
      amount?: number;
      currency: string;
      basis: string;
    }>;
    liveTotal?: { label: string; amount?: number; currency: string; basis: string };
    currency: string;
  };
  pricesVerified: boolean;
}

function formatMoney(amount: number | undefined, currency: string): string {
  if (amount === undefined) return "price unavailable";
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

const KIND_LABEL: Record<PlanItem["kind"], string> = {
  attraction: "Visit",
  meal: "Meal",
  stay: "Stay",
  note: "Note",
};

const VERDICT_STYLE: Record<TripPlanData["budgetVerdict"], string> = {
  within: "border-emerald-200 bg-emerald-50 text-emerald-800",
  exceeds_live_costs: "border-amber-200 bg-amber-50 text-amber-800",
  unknown: "border-stone-200 bg-stone-100 text-stone-600",
};

const VERDICT_LABEL: Record<TripPlanData["budgetVerdict"], string> = {
  within: "Within budget",
  exceeds_live_costs: "Exceeds budget (live costs)",
  unknown: "Budget unknown",
};

const PURPOSE_LABEL: Record<string, string> = {
  stay_selection: "stay research",
  attraction: "attraction research",
  meal: "restaurant research",
  context: "background research",
};

function EvidenceLine({ evidence }: { evidence: PlanEvidence[] }) {
  if (evidence.length === 0) return null;
  const sources = evidence.map((e) => {
    const bits: string[] = [];
    if (e.engine === "google_hotels") bits.push("Google Hotels");
    else if (e.engine === "google_maps") bits.push("Google Maps");
    else bits.push("Google Search");
    if (e.purpose && PURPOSE_LABEL[e.purpose]) {
      bits.push(PURPOSE_LABEL[e.purpose]);
    }
    if (typeof e.facts.rating === "number") bits.push(`rated ${e.facts.rating}`);
    return bits.join(" · ");
  });
  // First trustworthy place page across the item's evidence, if any.
  // Hotels carry no provider URL in the normalized data, so stays render
  // no link rather than a guessed one.
  const placeUrl = externalPlaceUrl(evidence);
  return (
    <>
      <p className="mt-1.5 text-xs text-stone-400">
        Evidence: {sources.join(" + ")}
      </p>
      {placeUrl && (
        <ExternalLink
          href={placeUrl}
          className="mt-1.5 inline-flex min-h-[36px] items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 shadow-sm hover:border-teal-700"
        >
          View Place ↗
        </ExternalLink>
      )}
    </>
  );
}

export default function ItineraryView({ plan }: { plan: TripPlanData }) {
  return (
    <section aria-label={`Itinerary for ${plan.destination}`} className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-teal-900/10 bg-gradient-to-r from-teal-950 via-teal-900 to-stone-800 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
            Your journey · Live research
          </p>
          <h2 className="mt-1 break-words text-xl font-bold leading-tight text-white sm:text-2xl">
            {plan.destination} · {plan.durationDays} day
            {plan.durationDays === 1 ? "" : "s"}
          </h2>
        </div>
        <div className="p-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${VERDICT_STYLE[plan.budgetVerdict]}`}
          >
            {VERDICT_LABEL[plan.budgetVerdict]}
          </span>
          {!plan.pricesVerified && (
            <span className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-xs text-stone-600">
              prices unverified
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-stone-600">
          {plan.dateMode === "fixed" && plan.startDate && plan.endDate
            ? `${plan.startDate} → ${plan.endDate} · `
            : "Flexible dates · "}
          {formatPartyLabel(plan.party)}
          {plan.budget &&
            ` · Budget ${plan.budget.currency} ${plan.budget.amount.toLocaleString("en-US")}`}
        </p>
        {plan.stay && (
          <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">
            <p className="break-words font-medium text-stone-900">
              Stay: {plan.stay.hotelName} × {plan.stay.nights} night
              {plan.stay.nights === 1 ? "" : "s"}
            </p>
            {plan.stay.total && (
              <p className="text-stone-600">
                {formatMoney(plan.stay.total.amount, plan.stay.total.currency)}{" "}
                <span className="text-xs">({plan.stay.total.basis} price)</span>
              </p>
            )}
          </div>
        )}
        {plan.totals.liveTotal && (
          <p className="mt-2 text-sm font-medium text-stone-900">
            Live total:{" "}
            {formatMoney(
              plan.totals.liveTotal.amount,
              plan.totals.liveTotal.currency,
            )}
          </p>
        )}
        </div>
      </div>

      {plan.destinationContext &&
        plan.destinationContext.summary.length > 0 && (
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-stone-900">
              About {plan.destination}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-stone-600">
              {plan.destinationContext.summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {plan.destinationContext.sources.length > 0 && (
              <p className="mt-2 text-xs text-stone-400">
                Sources:{" "}
                {plan.destinationContext.sources.map((s, i) => (
                  <span key={s.link}>
                    {i > 0 && " · "}
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {s.title}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}

      {plan.days.length === 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-600">
            No days planned yet. Adjust your destination or dates and plan again.
          </p>
        </div>
      )}

      {plan.days.map((day) => (
        <div
          key={day.dayNumber}
          className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
        >
          <div className="border-b border-stone-100 bg-gradient-to-r from-stone-100 to-teal-50/60 px-5 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-stone-900">
              Day {day.dayNumber} of {plan.durationDays}
              {day.date && (
                <span className="ml-2 font-normal normal-case tracking-normal text-stone-500">
                  {day.date}
                </span>
              )}
            </h3>
          </div>
          <ol className="space-y-0 px-5 py-2">
            {day.items.map((item) => (
              <li key={item.id} className="relative border-l-2 border-teal-200 py-3 pl-4">
                <span
                  aria-hidden="true"
                  className="absolute -left-[7px] top-4 h-3 w-3 rounded-full border-2 border-teal-300 bg-white"
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">
                    {KIND_LABEL[item.kind]}
                  </span>
                  {(item.startTime || item.endTime) && (
                    <span className="text-xs font-medium tabular-nums text-stone-500">
                      {item.startTime ?? ""}
                      {item.startTime && item.endTime ? "–" : ""}
                      {item.endTime ?? ""}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 break-words font-semibold text-stone-900">{item.title}</p>
                {item.place?.address && (
                  <p className="break-words text-sm text-stone-600">{item.place.address}</p>
                )}
                {typeof item.place?.rating === "number" && (
                  <p className="mt-0.5 text-sm text-amber-700">
                    <span aria-hidden="true">★ </span>
                    {item.place.rating.toFixed(1)}
                  </p>
                )}
                {item.estimatedDurationMinutes && (
                  <p className="text-xs text-stone-500">
                    Allow ~{Math.round(item.estimatedDurationMinutes / 30) / 2}h
                    (estimated)
                  </p>
                )}
                {item.notes && (
                  <p className="mt-0.5 break-words text-sm leading-relaxed text-stone-600">{item.notes}</p>
                )}
                {item.selectionReasons && item.selectionReasons.length > 0 && (
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">
                    Why here: {item.selectionReasons.slice(0, 3).join(" · ")}
                  </p>
                )}
                <EvidenceLine evidence={item.evidence} />
              </li>
            ))}
          </ol>
        </div>
      ))}

      {plan.assumptions.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-900">Assumptions</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-semibold text-amber-900">
            Things to know
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
