/**
 * User-facing RealityCheck report (Phase 5 Step 2).
 *
 * Renders the backend RealityCheckResult only — status semantics come from
 * the server and are never reinterpreted here. UNVERIFIED is displayed as
 * "could not be verified", never as a contradiction. Missing optional
 * fields render nothing; nothing is fabricated.
 */

export type CheckStatus =
  | "VERIFIED"
  | "NEEDS_ATTENTION"
  | "PROBLEM"
  | "UNVERIFIED";

export interface CheckFact {
  fact: string;
  supported: boolean;
  planned?: unknown;
  fresh?: unknown;
  outcome: string;
  detail?: string;
}

export interface CheckEvidence {
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
    nightlyExtracted?: number;
    totalExtracted?: number;
    address?: string;
    openState?: string;
  };
}

export interface CheckItem {
  itemId: string;
  kind: string;
  title: string;
  status: string;
  plannedEvidence?: CheckEvidence;
  freshEvidence?: CheckEvidence;
  facts: CheckFact[];
  reasons: string[];
}

export interface RealityCheckData {
  checkedAt: string;
  summary: {
    verified: number;
    needsAttention: number;
    problem: number;
    unverified: number;
  };
  items: CheckItem[];
  warnings: string[];
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "VERIFIED",
  "NEEDS_ATTENTION",
  "PROBLEM",
  "UNVERIFIED",
]);

export const STATUS_COPY: Record<CheckStatus, string> = {
  VERIFIED: "Current evidence supports the planned claim.",
  NEEDS_ATTENTION: "Evidence changed or is uncertain enough to review.",
  PROBLEM: "Strong contradiction requiring attention.",
  UNVERIFIED: "No sufficient evidence — could not be verified.",
};

const STATUS_STYLE: Record<CheckStatus, string> = {
  VERIFIED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  NEEDS_ATTENTION: "border-amber-200 bg-amber-50 text-amber-800",
  PROBLEM: "border-red-200 bg-red-50 text-red-800",
  UNVERIFIED: "border-stone-200 bg-stone-100 text-stone-600",
};

export const STATUS_LABEL: Record<CheckStatus, string> = {
  VERIFIED: "Verified",
  NEEDS_ATTENTION: "Needs attention",
  PROBLEM: "Problem",
  UNVERIFIED: "Unverified",
};

/** Human-readable label for any status string; unknown values pass through. */
export function statusLabel(status: string): string {
  return KNOWN_STATUSES.has(status)
    ? STATUS_LABEL[status as CheckStatus]
    : status;
}

const KIND_LABEL: Record<string, string> = {
  attraction: "Visit",
  meal: "Meal",
  stay: "Stay",
  note: "Note",
};

export type OverallStatus = CheckStatus | "NOT_CHECKED";

/**
 * Derives the headline status from summary counts only:
 * any problem dominates; otherwise any attention; otherwise verified
 * when at least one item verified; otherwise unverified. Pure and tested.
 */
export function deriveOverallStatus(summary: {
  verified: number;
  needsAttention: number;
  problem: number;
  unverified: number;
}): CheckStatus {
  if (summary.problem > 0) return "PROBLEM";
  if (summary.needsAttention > 0) return "NEEDS_ATTENTION";
  if (summary.verified > 0) return "VERIFIED";
  return "UNVERIFIED";
}

/** Formats a backend timestamp, or null when it is absent/invalid. */
export function formatCheckedAt(checkedAt: string): string | null {
  if (!checkedAt) return null;
  const time = new Date(checkedAt).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function sanitizeItem(value: unknown): CheckItem | null {
  if (!isRecord(value)) return null;
  const { itemId, kind, title, status, facts, reasons } = value;
  if (
    typeof itemId !== "string" ||
    typeof kind !== "string" ||
    typeof title !== "string" ||
    typeof status !== "string"
  ) {
    return null;
  }
  const cleanFacts: CheckFact[] = Array.isArray(facts)
    ? facts.filter(isRecord).map((f) => ({
        fact: typeof f.fact === "string" ? f.fact : "unknown",
        supported: f.supported === true,
        outcome:
          f.outcome === "matched" ||
          f.outcome === "changed" ||
          f.outcome === "missing" ||
          f.outcome === "conflicting" ||
          f.outcome === "unverifiable"
            ? f.outcome
            : "unverifiable",
        ...(typeof f.detail === "string" ? { detail: f.detail } : {}),
      }))
    : [];
  const cleanReasons = Array.isArray(reasons)
    ? reasons.filter((r): r is string => typeof r === "string").slice(0, 10)
    : [];
  const plannedEvidence = isRecord(value.plannedEvidence)
    ? (value.plannedEvidence as unknown as CheckEvidence)
    : undefined;
  const freshEvidence = isRecord(value.freshEvidence)
    ? (value.freshEvidence as unknown as CheckEvidence)
    : undefined;
  return {
    itemId,
    kind,
    title,
    status,
    facts: cleanFacts,
    reasons: cleanReasons,
    ...(plannedEvidence ? { plannedEvidence } : {}),
    ...(freshEvidence ? { freshEvidence } : {}),
  };
}

/**
 * Validates an unknown API payload into RealityCheckData.
 * Returns null for anything that is not a well-formed report —
 * callers must show an error, never render guesses.
 */
export function parseRealityCheckResponse(
  json: unknown,
): RealityCheckData | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) {
    return null;
  }
  const data = json.data;
  if (typeof data.checkedAt !== "string" || !isRecord(data.summary)) {
    return null;
  }
  const verified = toCount(data.summary.verified);
  const needsAttention = toCount(data.summary.needsAttention);
  const problem = toCount(data.summary.problem);
  const unverified = toCount(data.summary.unverified);
  if (
    verified === null ||
    needsAttention === null ||
    problem === null ||
    unverified === null
  ) {
    return null;
  }
  if (!Array.isArray(data.items)) return null;
  const items = data.items
    .map(sanitizeItem)
    .filter((i): i is CheckItem => i !== null);
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return {
    checkedAt: data.checkedAt,
    summary: { verified, needsAttention, problem, unverified },
    items,
    warnings,
  };
}

const STATUS_DOT: Record<CheckStatus, string> = {
  VERIFIED: "bg-emerald-600",
  NEEDS_ATTENTION: "bg-amber-500",
  PROBLEM: "bg-red-600",
  UNVERIFIED: "bg-stone-400",
};

/** Status glyphs are decorative; the adjacent text label carries meaning. */
const STATUS_GLYPH: Record<CheckStatus, string> = {
  VERIFIED: "✓",
  NEEDS_ATTENTION: "⚠",
  PROBLEM: "✕",
  UNVERIFIED: "•",
};

function statusBadge(status: string) {
  const known = KNOWN_STATUSES.has(status)
    ? (status as CheckStatus)
    : null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        known ? STATUS_STYLE[known] : "border-stone-200 bg-stone-100 text-stone-600"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${known ? STATUS_DOT[known] : "bg-stone-400"}`}
      />
      {known ? STATUS_LABEL[known] : status}
    </span>
  );
}

function FreshEvidenceLine({ evidence }: { evidence?: CheckEvidence }) {
  if (!evidence) return null;
  const bits: string[] = [];
  if (evidence.engine === "google_hotels") bits.push("Google Hotels");
  else if (evidence.engine === "google_maps") bits.push("Google Maps");
  else if (evidence.engine === "google") bits.push("Google Search");
  else if (evidence.engine) bits.push(evidence.engine);
  if (typeof evidence.facts?.rating === "number") {
    bits.push(`rated ${evidence.facts.rating}`);
  }
  if (typeof evidence.facts?.totalExtracted === "number") {
    const currency = evidence.currency ? `${evidence.currency} ` : "";
    bits.push(`total ${currency}${evidence.facts.totalExtracted.toLocaleString("en-US")}`);
  } else if (typeof evidence.facts?.nightlyExtracted === "number") {
    const currency = evidence.currency ? `${evidence.currency} ` : "";
    bits.push(`nightly ${currency}${evidence.facts.nightlyExtracted.toLocaleString("en-US")}`);
  }
  if (bits.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-stone-500">
      Fresh evidence: {bits.join(" · ")}
    </p>
  );
}

export default function RealityCheckReport({
  data,
}: {
  data: RealityCheckData;
}) {
  const overall = deriveOverallStatus(data.summary);
  const checkedAt = formatCheckedAt(data.checkedAt);
  const total =
    data.summary.verified +
    data.summary.needsAttention +
    data.summary.problem +
    data.summary.unverified;

  return (
    <section
      aria-label="RealityCheck report"
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
    >
      <div className="border-b border-teal-900/10 bg-gradient-to-r from-teal-950 via-teal-900 to-stone-800 p-5 pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
          RealityCheck · checked against live information
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-white">RealityCheck</h3>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            {STATUS_GLYPH[overall]} {STATUS_LABEL[overall]}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-stone-200">
          {STATUS_COPY[overall]}
        </p>
        {checkedAt && (
          <p className="mt-1 text-xs text-stone-300">
            Checked against live information · {checkedAt}
          </p>
        )}
      </div>
      <div className="space-y-4 p-5 pt-4">

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label="Check summary">
        {(
          [
            ["VERIFIED", data.summary.verified],
            ["NEEDS_ATTENTION", data.summary.needsAttention],
            ["PROBLEM", data.summary.problem],
            ["UNVERIFIED", data.summary.unverified],
          ] as Array<[CheckStatus, number]>
        ).map(([status, count]) => (
          <div
            key={status}
            role="listitem"
            className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-center"
          >
            <p className="text-xl font-bold tabular-nums text-stone-900">
              <span aria-hidden="true" className="mr-1 text-sm">{STATUS_GLYPH[status]}</span>
              {count}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-stone-500">
              {STATUS_LABEL[status]}
            </p>
          </div>
        ))}
      </div>

      {total > 0 && (
        <ol className="space-y-2.5">
          {data.items.map((item) => (
            <li
              key={item.itemId}
              className="rounded-xl border border-stone-200 bg-white p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(item.status)}
                <span className="text-xs text-stone-500">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
              </div>
              <p className="mt-1.5 break-words font-semibold text-stone-900">{item.title}</p>
              {item.reasons.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-stone-600">
                  {item.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              <FreshEvidenceLine evidence={item.freshEvidence} />
            </li>
          ))}
        </ol>
      )}

      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <ul className="list-disc space-y-1 pl-5">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </section>
  );
}
