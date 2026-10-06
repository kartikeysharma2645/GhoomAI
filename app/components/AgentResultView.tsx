"use client";

import ItineraryView, { type TripPlanData } from "./ItineraryView";
import RealityCheckReport, { type RealityCheckData } from "./RealityCheckReport";
import ResultCards, { type AskResponseData } from "./ResultCards";

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

function AdapterCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-neutral-900">{title}</p>
      <div className="mt-2 space-y-2 text-sm text-neutral-700">{children}</div>
    </div>
  );
}

function ProposalAdapter({ proposal }: { proposal: unknown }) {
  if (!isRecord(proposal) || !Array.isArray(proposal.changes)) return null;
  const changes = proposal.changes.filter(isRecord);
  const unfixable = Array.isArray(proposal.unfixable)
    ? proposal.unfixable.filter(isRecord)
    : [];
  if (changes.length === 0 && unfixable.length === 0) {
    return <p className="text-sm text-neutral-600">No verified alternatives right now.</p>;
  }
  return (
    <div className="space-y-2">
      {changes.map((c, i) => (
        <div key={String(c.itemId ?? i)} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <p className="text-sm text-neutral-500">
            Replace: {String(c.originalTitle ?? c.itemId ?? "item")}
          </p>
          <p className="font-medium text-neutral-900">
            With: {isRecord(c.replacement) ? String(c.replacement.title ?? "?") : "?"}
          </p>
          {textList(c.reasons, 2).map((r) => (
            <p key={r} className="mt-1 text-xs text-neutral-500">{r}</p>
          ))}
        </div>
      ))}
      {unfixable.length > 0 && (
        <p className="text-xs text-neutral-500">
          Could not fix: {unfixable.map((u) => String(u.title ?? u.itemId)).join(", ")}
        </p>
      )}
    </div>
  );
}

function OptionsAdapter({ discovery }: { discovery: unknown }) {
  if (!isRecord(discovery) || !Array.isArray(discovery.items)) return null;
  const items = discovery.items.filter(isRecord);
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const options = Array.isArray(item.options) ? item.options.filter(isRecord) : [];
        if (options.length === 0) return null;
        return (
          <div key={String(item.itemId ?? i)} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            <p className="font-medium text-neutral-900">{String(item.title ?? "Options")}</p>
            <ul className="mt-2 space-y-2">
              {options.map((o, j) => (
                <li key={String(o.optionId ?? j)} className="rounded-lg bg-neutral-50 p-2 text-sm">
                  <p className="font-medium text-neutral-900">{String(o.title ?? "?")}</p>
                  <p className="text-xs text-neutral-500">
                    {String(o.leadType === "CORROBORATED" ? "Corroborated · " : "Search lead · ")}
                    {String(o.provider ?? "")}
                  </p>
                  {typeof o.url === "string" && o.url ? (
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-sm font-medium text-sky-700 hover:underline"
                    >
                      Continue to provider
                    </a>
                  ) : (
                    <p className="text-xs text-neutral-500">Search lead — no direct page.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="text-xs text-neutral-500">
        GhoomAI did not complete any booking — continue externally.
      </p>
    </div>
  );
}

function RecheckAdapter({ recheck }: { recheck: unknown }) {
  if (!isRecord(recheck)) return null;
  const summary = isRecord(recheck.summary) ? recheck.summary : null;
  const options = Array.isArray(recheck.options) ? recheck.options.filter(isRecord) : [];
  return (
    <AdapterCard title={`Final check: ${String(recheck.verdict ?? "?")}`}>
      {summary && (
        <p className="text-sm">
          {String(summary.verified ?? 0)} verified · {String(summary.needsAttention ?? 0)} needing
          attention · {String(summary.problem ?? 0)} problem · {String(summary.unverified ?? 0)} unverified
        </p>
      )}
      {options.map((o, i) => (
        <p key={String(o.optionId ?? i)} className="text-sm">
          <span className="font-medium">{String(o.title ?? "?")}</span>
          {" — "}{String(o.status ?? "?").replace(/_/g, " ")}
        </p>
      ))}
      <p className="text-xs text-neutral-500">Freshly checked — not a booking.</p>
    </AdapterCard>
  );
}

function CountsAdapter({ title, lines }: { title: string; lines: string[] }) {
  return (
    <AdapterCard title={title}>
      {lines.map((line) => (
        <p key={line} className="text-sm">{line}</p>
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
    <AdapterCard title={`Visual identification: ${String(analysis.status ?? "?")}`}>
      {candidates.slice(0, 3).map((c, i) => (
        <p key={i} className="text-sm">
          <span className="font-medium">{String(c.name ?? "?")}</span>
          {typeof c.confidence === "number" ? ` — ${Math.round(c.confidence * 100)}%` : ""}
          {typeof c.city === "string" && c.city ? ` · ${c.city}` : ""}
        </p>
      ))}
      {candidates.length === 0 && (
        <p className="text-sm text-neutral-600">No candidates identified.</p>
      )}
      <p className="text-xs text-neutral-500">Approximate — verify before planning around it.</p>
    </AdapterCard>
  );
}

function SituationsAdapter({ liveCheck }: { liveCheck: unknown }) {
  if (!isRecord(liveCheck)) return null;
  const situations = Array.isArray(liveCheck.situations)
    ? liveCheck.situations.filter(isRecord)
    : [];
  if (situations.length === 0) {
    return <p className="text-sm text-neutral-600">No disruptions detected.</p>;
  }
  return (
    <AdapterCard title={`Live situations (${situations.length})`}>
      {situations.slice(0, 5).map((s, i) => (
        <p key={String(s.id ?? i)} className="text-sm">
          <span className="font-medium">{String(s.type ?? "Notice")}</span>
          {typeof s.summary === "string" ? ` — ${s.summary}` : ""}
        </p>
      ))}
    </AdapterCard>
  );
}

export default function AgentResultView({ turn }: { turn: AgentTurnView }) {
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
    return <ResultCards data={data as unknown as AskResponseData} />;
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
      <AdapterCard title="Selected for external handoff">
        <p className="text-sm font-medium">{String(s.title ?? "?")}</p>
        <p className="text-xs text-neutral-500">{String(s.provider ?? "")}</p>
        <p className="text-xs text-neutral-500">GhoomAI did not book anything.</p>
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
    return <CountsAdapter title="Trip overview" lines={lines} />;
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
