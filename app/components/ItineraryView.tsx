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
  party: { adults: number; children: number };
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
  within: "bg-emerald-100 text-emerald-900",
  exceeds_live_costs: "bg-amber-100 text-amber-900",
  unknown: "bg-neutral-100 text-neutral-600",
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
      <p className="mt-1 text-xs text-neutral-400">
        Evidence: {sources.join(" + ")}
      </p>
      {placeUrl && (
        <ExternalLink
          href={placeUrl}
          className="mt-1 inline-block text-xs font-medium text-sky-700 hover:underline"
        >
          View Place ↗
        </ExternalLink>
      )}
    </>
  );
}

export default function ItineraryView({ plan }: { plan: TripPlanData }) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold text-neutral-900">
            {plan.destination} · {plan.durationDays} day
            {plan.durationDays === 1 ? "" : "s"}
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${VERDICT_STYLE[plan.budgetVerdict]}`}
          >
            {VERDICT_LABEL[plan.budgetVerdict]}
          </span>
          {!plan.pricesVerified && (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">
              prices unverified
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {plan.dateMode === "fixed" && plan.startDate && plan.endDate
            ? `${plan.startDate} → ${plan.endDate} · `
            : "Flexible dates · "}
          {plan.party.adults} adult{plan.party.adults === 1 ? "" : "s"}
          {plan.party.children > 0 &&
            `, ${plan.party.children} ${plan.party.children === 1 ? "child" : "children"}`}
          {plan.budget &&
            ` · Budget ${plan.budget.currency} ${plan.budget.amount.toLocaleString("en-US")}`}
        </p>
        {plan.stay && (
          <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-sm">
            <p className="font-medium text-neutral-900">
              Stay: {plan.stay.hotelName} × {plan.stay.nights} night
              {plan.stay.nights === 1 ? "" : "s"}
            </p>
            {plan.stay.total && (
              <p className="text-neutral-600">
                {formatMoney(plan.stay.total.amount, plan.stay.total.currency)}{" "}
                <span className="text-xs">({plan.stay.total.basis} price)</span>
              </p>
            )}
          </div>
        )}
        {plan.totals.liveTotal && (
          <p className="mt-2 text-sm font-medium text-neutral-900">
            Live total:{" "}
            {formatMoney(
              plan.totals.liveTotal.amount,
              plan.totals.liveTotal.currency,
            )}
          </p>
        )}
      </div>

      {plan.destinationContext &&
        plan.destinationContext.summary.length > 0 && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-neutral-700">
              About {plan.destination}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
              {plan.destinationContext.summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {plan.destinationContext.sources.length > 0 && (
              <p className="mt-2 text-xs text-neutral-400">
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
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-neutral-600">
            No days planned yet. Adjust your destination or dates and plan again.
          </p>
        </div>
      )}

      {plan.days.map((day) => (
        <div
          key={day.dayNumber}
          className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h3 className="font-bold text-neutral-900">
            Day {day.dayNumber}
            {day.date && (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {day.date}
              </span>
            )}
          </h3>
          <ol className="mt-3 space-y-3">
            {day.items.map((item) => (
              <li key={item.id} className="border-l-2 border-sky-200 pl-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-sky-700">
                    {KIND_LABEL[item.kind]}
                  </span>
                  {(item.startTime || item.endTime) && (
                    <span className="text-xs text-neutral-500">
                      {item.startTime ?? ""}
                      {item.startTime && item.endTime ? "–" : ""}
                      {item.endTime ?? ""}
                    </span>
                  )}
                </div>
                <p className="font-medium text-neutral-900">{item.title}</p>
                {item.place?.address && (
                  <p className="text-sm text-neutral-600">{item.place.address}</p>
                )}
                {typeof item.place?.rating === "number" && (
                  <p className="text-sm text-amber-700">
                    {item.place.rating.toFixed(1)}
                  </p>
                )}
                {item.estimatedDurationMinutes && (
                  <p className="text-xs text-neutral-500">
                    Allow ~{Math.round(item.estimatedDurationMinutes / 30) / 2}h
                    (estimated)
                  </p>
                )}
                {item.notes && (
                  <p className="text-sm text-neutral-600">{item.notes}</p>
                )}
                {item.selectionReasons && item.selectionReasons.length > 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
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
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-medium text-neutral-700">Assumptions</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-medium text-amber-900">
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
