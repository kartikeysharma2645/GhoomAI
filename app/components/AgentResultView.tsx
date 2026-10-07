"use client";

import React from "react";
import ExternalLink from "./ExternalLink";
import ItineraryView, { type TripPlanData } from "./ItineraryView";
import RealityCheckReport, { type RealityCheckData } from "./RealityCheckReport";
import ResultCards, { type AskResponseData } from "./ResultCards";
import { formatCheckedAt, statusLabel } from "./agentChatHelpers";
import { AgentCard, Eyebrow } from "./agent-ui";

/**
 * Maps a typed `/api/agent` turn to rendered output (Phase 10 Prompt 3).
 *
 * Existing pure viewers (ItineraryView, RealityCheckReport, ResultCards)
 * are embedded directly as the source of truth for presentation. Stateful
 * or interactive flows are NOT re-embedded (that would duplicate live
 * calls); instead small read-only adapters present exactly the data the
 * agent turn already returned, with no business logic of their own.
 */

export interface AgentTurnView {
  intent: string;
  outcome: string;
  capability: string;
  message: string;
  data?: unknown;
  followUps: string[];
  confirmationRequired?: { action: string; summary: string; requestedAt: string };
  errorCode?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, limit);
}

function AdapterCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AgentCard>
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="mt-1 text-[15px] font-bold text-stone-900">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-700">{children}</div>
    </AgentCard>
  );
}

function ProposalAdapter({ proposal }: { proposal: unknown }) {
  if (!isRecord(proposal) || !Array.isArray(proposal.changes)) return null;
  const changes = proposal.changes.filter(isRecord);
  const unfixable = Array.isArray(proposal.unfixable)
    ? proposal.unfixable.filter(isRecord)
    : [];
  if (changes.length === 0 && unfixable.length === 0) {
    return (
      <AgentCard>
        <p className="text-sm text-stone-600">No verified alternatives right now.</p>
      </AgentCard>
    );
  }
  return (
    <section aria-label="Replacement options" className="space-y-2.5">
      <Eyebrow>Replacement options</Eyebrow>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {changes.map((c, i) => {
          const replacement = isRecord(c.replacement) ? c.replacement : null;
          const title = replacement && typeof replacement.title === "string" ? replacement.title : "?";
          const detail =
            replacement && typeof replacement.detail === "string" ? replacement.detail : null;
          return (
            <article
              key={String(c.itemId ?? i)}
              className="flex flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-stone-500">
                Instead of {String(c.originalTitle ?? c.itemId ?? "this stop")}
              </p>
              <h4 className="mt-0.5 break-words text-[15px] font-bold text-stone-900">{title}</h4>
              {detail && <p className="mt-1 text-[13px] text-stone-600">{detail}</p>}
              {textList(c.reasons, 2).map((r) => (
                <p key={r} className="mt-1 text-xs leading-relaxed text-stone-500">
                  {r}
                </p>
              ))}
              {typeof c.checkedAt === "string" && (
                <p className="mt-2 text-[11px] text-stone-400">
                  Verified {formatCheckedAt(c.checkedAt)}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {unfixable.length > 0 && (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-500">
          Could not fix: {unfixable.map((u) => String(u.title ?? u.itemId)).join(", ")}
        </p>
      )}
    </section>
  );
}

function OptionsAdapter({ discovery }: { discovery: unknown }) {
  if (!isRecord(discovery) || !Array.isArray(discovery.items)) return null;
  const items = discovery.items.filter(isRecord);
  const withOptions = items.filter(
    (item) => Array.isArray(item.options) && item.options.filter(isRecord).length > 0,
  );
  if (withOptions.length === 0) {
    return (
      <AgentCard>
        <p className="text-sm text-stone-600">
          No suitable live options were found. Try again later, or adjust the
          itinerary and run a fresh check first.
        </p>
      </AgentCard>
    );
  }
  return (
    <section aria-label="Booking options" className="space-y-2.5">
      <Eyebrow>Booking options · external handoff</Eyebrow>
      <div className="space-y-2.5">
        {withOptions.map((item, i) => {
          const options = Array.isArray(item.options) ? item.options.filter(isRecord) : [];
          if (options.length === 0) return null;
          return (
            <article
              key={String(item.itemId ?? i)}
              className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
            >
              <h4 className="break-words text-[15px] font-bold text-stone-900">
                {String(item.title ?? "Options")}
              </h4>
              <ul className="mt-2.5 space-y-2">
                {options.map((o, j) => (
                  <li
                    key={String(o.optionId ?? j)}
                    className="rounded-xl bg-stone-50 p-3 text-sm"
                  >
                    <p className="break-words font-semibold text-stone-900">
                      {String(o.title ?? "?")}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      <span className="font-medium text-stone-600">
                        {String(o.leadType === "CORROBORATED" ? "Corroborated" : "Search lead")}
                      </span>
                      {typeof o.provider === "string" && o.provider
                        ? ` · ${o.provider}`
                        : ""}
                    </p>
                    {typeof o.url === "string" && o.url ? (
                      <ExternalLink
                        href={o.url}
                        className="mt-1.5 inline-flex min-h-[36px] items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-medium text-teal-800 shadow-sm hover:border-teal-700"
                      >
                        Continue to provider ↗
                      </ExternalLink>
                    ) : (
                      <p className="mt-1 text-xs text-stone-500">
                        Search lead — no direct page.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <p className="text-xs text-stone-500">
        GhoomAI did not complete any booking — continue externally.
      </p>
    </section>
  );
}

function RecheckAdapter({ recheck }: { recheck: unknown }) {
  if (!isRecord(recheck)) return null;
  const summary = isRecord(recheck.summary) ? recheck.summary : null;
  const options = Array.isArray(recheck.options) ? recheck.options.filter(isRecord) : [];
  return (
    <AdapterCard eyebrow="Final pre-trip check" title={`Final check: ${statusLabel(recheck.verdict)}`}>
      {summary && (
        <p className="text-sm">
          {String(summary.verified ?? 0)} verified · {String(summary.needsAttention ?? 0)} needing
          attention · {String(summary.problem ?? 0)} problem · {String(summary.unverified ?? 0)} unverified
        </p>
      )}
      {options.length > 0 && (
        <ul className="space-y-1">
          {options.map((o, i) => (
            <li key={String(o.optionId ?? i)} className="text-sm">
              <span className="font-medium">{String(o.title ?? "?")}</span>
              {" — "}{statusLabel(o.status)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-500">Freshly checked — not a booking.</p>
    </AdapterCard>
  );
}

function CountsAdapter({ title, lines, eyebrow }: { title: string; lines: string[]; eyebrow: string }) {
  return (
    <AdapterCard eyebrow={eyebrow} title={title}>
      {lines.map((line) => (
        <p key={line} className="break-words text-sm">
          {line}
        </p>
      ))}
    </AdapterCard>
  );
}

function AnalysisAdapter({ analysis }: { analysis: unknown }) {
  if (!isRecord(analysis)) return null;
  const candidates = Array.isArray(analysis.candidates)
    ? analysis.candidates.filter(isRecord)
    : [];
  return (
    <AdapterCard
      eyebrow="Visual identification"
      title={`Visual identification: ${statusLabel(analysis.status)}`}
    >
      {candidates.slice(0, 3).map((c, i) => (
        <p key={i} className="text-sm">
          <span className="font-medium">{String(c.name ?? "?")}</span>
          {typeof c.confidence === "number" ? ` — ${Math.round(c.confidence * 100)}%` : ""}
          {typeof c.city === "string" && c.city ? ` · ${c.city}` : ""}
        </p>
      ))}
      {candidates.length === 0 && (
        <p className="text-sm text-stone-600">No candidates identified.</p>
      )}
      <p className="text-xs text-stone-500">Approximate — verify before planning around it.</p>
    </AdapterCard>
  );
}

function SituationsAdapter({ liveCheck }: { liveCheck: unknown }) {
  if (!isRecord(liveCheck)) return null;
  const situations = Array.isArray(liveCheck.situations)
    ? liveCheck.situations.filter(isRecord)
    : [];
  if (situations.length === 0) {
    return (
      <AgentCard>
        <p className="text-sm text-stone-600">No disruptions detected.</p>
      </AgentCard>
    );
  }
  return (
    <AdapterCard eyebrow="Live situations" title={`Live situations (${situations.length})`}>
      {situations.slice(0, 5).map((s, i) => (
        <p key={String(s.id ?? i)} className="text-sm">
          <span className="font-medium">{statusLabel(s.type)}</span>
          {typeof s.summary === "string" ? ` — ${s.summary}` : ""}
        </p>
      ))}
    </AdapterCard>
  );
}

export default function AgentResultView({
  turn,
  onAction,
}: {
  turn: AgentTurnView;
  /**
   * Sends a normal agent message for result-level actions (currently the
   * place "Plan a trip here" button). Wired by AgentChat only — never a
   * confirmation bypass, never a new capability.
   */
  onAction?: (message: string) => void;
}) {
  const data = isRecord(turn.data) ? turn.data : null;
  if (!data) return null;

  // Search intents return the Phase 3 card response shape.
  if (
    (turn.intent === "find_hotels" ||
      turn.intent === "discover_places" ||
      turn.intent === "general_search") &&
    typeof data.engine === "string" &&
    Array.isArray(data.results)
  ) {
    return <ResultCards data={data as unknown as AskResponseData} onPlanHere={onAction} />;
  }

  if (
    (turn.intent === "plan_trip" || turn.intent === "fix_trip") &&
    isRecord(data.plan) &&
    typeof data.plan.destination === "string" &&
    Array.isArray(data.plan.days)
  ) {
    return <ItineraryView plan={data.plan as unknown as TripPlanData} />;
  }

  if (turn.intent === "check_trip" && isRecord(data.check) && isRecord(data.check.summary)) {
    return <RealityCheckReport data={data.check as unknown as RealityCheckData} />;
  }

  if (turn.intent === "fix_trip" && "proposal" in data) {
    return <ProposalAdapter proposal={data.proposal} />;
  }

  if (turn.intent === "booking_discover" && "discovery" in data) {
    return <OptionsAdapter discovery={data.discovery} />;
  }

  if (turn.intent === "booking_select" && isRecord(data.selection)) {
    const s = data.selection;
    return (
      <AdapterCard eyebrow="Booking handoff" title="Selected for external handoff">
        <p className="break-words text-sm font-medium">{String(s.title ?? "?")}</p>
        <p className="text-xs text-stone-500">{String(s.provider ?? "")}</p>
        <p className="text-xs text-stone-500">GhoomAI did not book anything.</p>
      </AdapterCard>
    );
  }

  if (turn.intent === "booking_recheck" && "recheck" in data) {
    return <RecheckAdapter recheck={data.recheck} />;
  }

  if (turn.intent === "activate_trip" && isRecord(data.trip)) {
    const t = data.trip;
    const plan = isRecord(t.plan) ? t.plan : null;
    return (
      <CountsAdapter
        eyebrow="Trip activation"
        title="Trip active"
        lines={[
          plan && typeof plan.destination === "string"
            ? `${String(plan.destination)} · day ${String(t.currentDayNumber ?? 1)} of ${String(plan.durationDays ?? "?")}`
            : "Live tracking started.",
          "Ask “What's next?” as you travel.",
        ]}
      />
    );
  }

  if (
    (turn.intent === "trip_status" || turn.intent === "trip_progress") &&
    ("summary" in data || "tripStatus" in data)
  ) {
    const summary = isRecord(data.summary) ? data.summary : null;
    const lines: string[] = [];
    if (typeof data.tripStatus === "string") lines.push(`Status: ${data.tripStatus}`);
    if (summary) {
      lines.push(
        `${String(summary.completed ?? 0)}/${String(summary.total ?? 0)} done · ${String(summary.remaining ?? 0)} remaining`,
      );
    }
    if (typeof data.currentDayNumber === "number") {
      lines.push(`Current day: ${data.currentDayNumber}`);
    }
    if (lines.length === 0) return null;
    return <CountsAdapter eyebrow="Live trip" title="Trip overview" lines={lines} />;
  }

  if (turn.intent === "reschedule_advice") {
    if ("proposal" in data) return <ProposalAdapter proposal={data.proposal} />;
    if ("liveCheck" in data) return <SituationsAdapter liveCheck={data.liveCheck} />;
    return null;
  }

  if (turn.intent === "identify_place" && "analysis" in data) {
    return <AnalysisAdapter analysis={data.analysis} />;
  }

  return null;
}
