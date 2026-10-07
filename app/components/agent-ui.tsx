/**
 * Reusable presentational primitives for the /agent travel-agent surface.
 *
 * Stateless and purely visual — no network, no session state, no business
 * logic. All copy shown here is generic chrome ("Live data", "Send");
 * travel facts, URLs, and statuses always come from server-returned data
 * rendered by the callers.
 */

import React from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Small uppercase section eyebrow, e.g. "Trip planning · Live data". */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-800">
      {children}
    </p>
  );
}

/** Subtle live-data marker — no engine names, no internal IDs. */
export function LiveBadge({ label = "Live data" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
      {label}
    </span>
  );
}

/** Generic white card used across agent results. */
export function AgentCard({
  children,
  className,
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-5",
        className,
      )}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
    >
      {children}
    </div>
  );
}

type ButtonTone = "primary" | "secondary" | "ghost" | "danger-outline";

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary:
    "bg-stone-900 text-white hover:bg-stone-700 focus-visible:ring-stone-900 disabled:hover:bg-stone-900",
  secondary:
    "border border-stone-300 bg-white text-stone-800 hover:border-stone-500 hover:bg-stone-50 focus-visible:ring-stone-500 disabled:hover:border-stone-300 disabled:hover:bg-white",
  ghost: "text-teal-800 hover:bg-teal-50 focus-visible:ring-teal-700",
  "danger-outline":
    "border border-red-300 bg-white text-red-800 hover:bg-red-50 focus-visible:ring-red-600",
};

export function ActionButton({
  children,
  tone = "secondary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
}) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_TONES[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Follow-up suggestion pill — sends a normal agent message. */
export function SuggestionPill({
  children,
  disabled,
  onSelect,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className="inline-flex max-w-full items-center rounded-full border border-stone-300 bg-white px-3 py-1.5 text-left text-[13px] text-stone-700 shadow-sm transition-colors hover:border-stone-500 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Three-dot typing indicator for the agent "working" state. */
export function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </span>
  );
}

/** Human-readable error panel that never renders raw JSON or stacks. */
export function ErrorPanel({
  message,
  onRestart,
  showRestart,
}: {
  message: string;
  onRestart: () => void;
  showRestart: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <p className="font-medium">Something didn&apos;t work</p>
      <p className="mt-0.5 break-words">{message}</p>
      <p className="mt-1 text-xs text-red-700">
        Nothing was changed — you can try again or start fresh.
      </p>
      {showRestart && (
        <ActionButton type="button" tone="primary" onClick={onRestart} className="mt-3">
          Start a new conversation
        </ActionButton>
      )}
    </div>
  );
}
