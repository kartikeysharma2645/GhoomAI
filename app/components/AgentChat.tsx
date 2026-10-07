"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  ACCEPTED_IMAGE_MIMES,
  APPROVAL_CTA,
  asConfirmAction,
  buildConfirmPayload,
  cancelPayload,
  intentLabel,
  isAcceptedImage,
  requiresApproval,
  type ConfirmPayload,
} from "./agentChatHelpers";
import AgentResultView, { type AgentTurnView } from "./AgentResultView";
import { postJson } from "./request";
import {
  DiscoveryContextHeader,
  DiscoveryHero,
  InspirationGrid,
  QuickTiles,
  TrustStrip,
  WorkspaceBanner,
} from "./agent-travel";
import { discoveryCategory } from "./travel-images";
import {
  ActionButton,
  AgentCard,
  ErrorPanel,
  LiveBadge,
  SuggestionPill,
  TypingDots,
} from "./agent-ui";

/**
 * Unified conversational GhoomAI surface (Phase 10 Prompt 3).
 *
 * The browser holds the ConversationSession and POSTs it with every turn
 * to our own `/api/agent`; the server returns the typed turn plus the
 * updated session, which replaces local state. No database, no secrets,
 * no direct SerpApi calls — all capability work stays server-side.
 *
 * Honesty rules enforced here:
 * - only the server-returned message is rendered (plain text, never HTML);
 * - follow-ups send normal messages and can never bypass confirmation;
 * - Confirm/Cancel appear only on the latest turn carrying
 *   `confirmationRequired`, built solely from server-returned data;
 * - a failed turn keeps the previous conversation; only the session the
 *   server returned replaces local state.
 *
 * Presentation (UI Phase 1.5) has two modes sharing one composer and one
 * request path: a travel-discovery landing while the conversation is
 * empty, and a focused workspace once it begins.
 */

interface ChatTurn {
  id: number;
  role: "user" | "agent";
  text: string;
  turn?: AgentTurnView;
}

interface SessionState {
  sessionVersion: 1;
  transcript: unknown[];
  tripStatus: string;
  [key: string]: unknown;
}

const FRESH_SESSION: SessionState = {
  sessionVersion: 1,
  transcript: [],
  tripStatus: "DRAFT",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(json: unknown, fallback: string): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return fallback;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read image."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

/** Intents whose responses are backed by fresh provider evidence. */
function hasLiveEvidence(turn: AgentTurnView): boolean {
  return (
    turn.intent === "find_hotels" ||
    turn.intent === "discover_places" ||
    turn.intent === "general_search" ||
    turn.intent === "check_trip" ||
    turn.intent === "booking_discover" ||
    turn.intent === "booking_recheck"
  );
}

/**
 * Working-state copy derived from the pending user message only.
 * Every label maps to a real capability path; no progress percentages,
 * no artificial delays — the flag clears the moment the request settles.
 */
function workingLabel(pendingText: string): string {
  const t = pendingText.toLowerCase();
  if (/(realitycheck|reality check|verify|verification|check (my|this|the) (trip|itinerary|plan))/.test(t)) {
    return "Checking your itinerary against live information…";
  }
  if (/(replace|replacement|instead|don't want|fix|correction)/.test(t)) {
    return "Finding replacement options…";
  }
  if (/(book|booking|handoff|provider|hotel|option)/.test(t)) {
    return "Preparing booking options…";
  }
  if (/(live|status|progress|what'?s next|delayed|reschedul)/.test(t)) {
    return "Checking your live trip…";
  }
  if (/(plan|trip|itinerary|day|jaipur|goa|delhi|agra|travel)/.test(t)) {
    return "Planning your trip…";
  }
  return "Searching live travel information…";
}

/** Shows the contextual next-step button only for a completed trip plan. */
function showRealityCheckNudge(turn: AgentTurnView): boolean {
  return turn.intent === "plan_trip" && turn.outcome === "completed" && !turn.confirmationRequired;
}

const REALITYCHECK_NUDGE_MESSAGE =
  "Please run a RealityCheck on this itinerary against live information.";

export default function AgentChat() {
  const [session, setSession] = useState<SessionState>(FRESH_SESSION);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionBroken, setSessionBroken] = useState(false);
  const [image, setImage] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const [activeConfirmTurnId, setActiveConfirmTurnId] = useState<number | null>(null);
  const idRef = useRef(1);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function send(
    text: string,
    confirm?: ConfirmPayload,
    attachedImage?: { base64: string; mimeType: string } | null,
  ) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setPendingText(trimmed);
    setError(null);
    setSessionBroken(false);
    const userId = idRef.current++;
    setTurns((prev) => [...prev, { id: userId, role: "user", text: trimmed }]);
    // A new outbound message retires any shown confirmation box.
    setActiveConfirmTurnId(null);
    try {
      const { status, json } = await postJson(
        "/api/agent",
        {
          session,
          message: trimmed,
          ...(confirm ? { confirm } : {}),
          ...(attachedImage
            ? { imageBase64: attachedImage.base64, imageMimeType: attachedImage.mimeType }
            : {}),
        },
      );
      if (status !== 200 || !isRecord(json) || json.ok !== true || !isRecord(json.data)) {
        if (status === 400) setSessionBroken(true);
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      const turn = json.data as unknown as AgentTurnView & { session: SessionState };
      if (!isRecord(turn.session)) throw new Error("Unexpected agent response.");
      setSession(turn.session);
      const agentId = idRef.current++;
      setTurns((prev) => [...prev, { id: agentId, role: "agent", text: turn.message, turn }]);
      if (turn.confirmationRequired) setActiveConfirmTurnId(agentId);
      setImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
      setPendingText("");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const attached = image ? { base64: image.base64, mimeType: image.mimeType } : null;
    void send(input, undefined, attached);
    setInput("");
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const attached = image ? { base64: image.base64, mimeType: image.mimeType } : null;
      void send(input, undefined, attached);
      setInput("");
    }
  }

  function onFollowUp(suggestion: string) {
    setInput("");
    void send(suggestion);
  }

  function onConfirm(turn: AgentTurnView) {
    const payload = buildConfirmPayload(turn);
    if (!payload) {
      setError("This confirmation is no longer valid. Please ask again.");
      return;
    }
    setActiveConfirmTurnId(null);
    void send(`Yes — ${turn.confirmationRequired?.summary ?? "confirmed"}`, payload);
  }

  function onCancel(turn: AgentTurnView) {
    if (!turn.confirmationRequired) return;
    const action = asConfirmAction(turn.confirmationRequired.action);
    if (!action) {
      setError("This confirmation is no longer valid. Please ask again.");
      return;
    }
    setActiveConfirmTurnId(null);
    void send("Cancel", cancelPayload(action));
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!isAcceptedImage({ type: file.type, size: file.size })) {
      setError("Attach a JPEG, PNG, or WebP image up to 8 MB.");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setImage({ name: file.name, base64, mimeType: file.type });
      setError(null);
    } catch {
      setError("Could not read that image.");
    }
  }

  function restart() {
    setSession(FRESH_SESSION);
    setTurns([]);
    setError(null);
    setSessionBroken(false);
    setImage(null);
    setActiveConfirmTurnId(null);
    setInput("");
    setPendingText("");
  }

  const started = turns.length > 0;

  /**
   * Visual-discovery deep-link (`/agent?discover=<key>`): auto-submit the
   * category's prompt through the normal `send` path — identical payload,
   * confirmation gates, and session handling as a typed message. The
   * consumed-ref prevents re-sends on re-render while still honoring a
   * *new* key when the user picks another category mid-conversation.
   */
  const searchParams = useSearchParams();
  const discoverKey = searchParams.get("discover");
  const discoverConsumed = useRef<string | null>(null);
  useEffect(() => {
    if (!discoverKey || discoverConsumed.current === discoverKey) return;
    const category = discoveryCategory(discoverKey);
    if (!category) return;
    discoverConsumed.current = discoverKey;
    void send(category.prompt);
    // send is intentionally mount/intent-scoped; re-running on its
    // identity change would duplicate the discovery request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverKey]);

  const activeDiscovery = discoveryCategory(discoverKey);

  /**
   * One composer, two skins. Same payload, same multiline/Enter/Photo/
   * count/loading behavior in the hero and in the workspace — only the
   * surrounding surface changes.
   */
  function renderComposer(variant: "hero" | "bar") {
    const hero = variant === "hero";
    return (
      <form
        onSubmit={onSubmit}
        className={
          hero
            ? "rounded-2xl bg-white/95 p-2 shadow-2xl backdrop-blur focus-within:ring-2 focus-within:ring-amber-200"
            : "sticky bottom-3 z-10 rounded-2xl border border-stone-300 bg-white p-2 shadow-[0_4px_16px_rgba(0,0,0,0.08)] focus-within:border-teal-800"
        }
      >
        <label htmlFor="agent-message" className="sr-only">
          Message GhoomAI
        </label>
        <textarea
          id="agent-message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={
            hero
              ? "Where do you want to go?"
              : "Ask GhoomAI about your trip… (Enter to send, Shift+Enter for a new line)"
          }
          maxLength={500}
          rows={2}
          disabled={loading}
          autoComplete="off"
          className="max-h-32 min-h-[52px] w-full resize-y rounded-xl bg-transparent px-3 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60"
        />
        <div className="flex items-center gap-2 px-1 pb-1">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIMES.join(",")}
            className="sr-only"
            aria-label="Attach a photo"
            disabled={loading}
            onChange={(e) => {
              void onPickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a photo"
            title="Attach a photo"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Photo
          </button>
          <span className="ml-auto text-[11px] text-stone-400" aria-hidden="true">
            {input.length}/500
          </span>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-stone-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Thinking…" : "Send"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    );
  }

  function renderAttachedNote() {
    if (!image) return null;
    return (
      <p className="mt-2 break-words text-xs text-stone-500">
        Attached: {image.name} (sent with your next message, never stored).
        <button
          type="button"
          onClick={() => setImage(null)}
          className="ml-2 underline hover:text-stone-900"
        >
          Remove
        </button>
      </p>
    );
  }

  function renderError() {
    if (!error) return null;
    return (
      <div className="mt-4">
        <ErrorPanel message={error} onRestart={restart} showRestart={sessionBroken} />
        {!sessionBroken && (
          <button
            type="button"
            onClick={restart}
            className="mt-2 text-xs text-stone-500 underline hover:text-stone-900"
          >
            Start a new conversation instead
          </button>
        )}
      </div>
    );
  }

  /* ---------------- MODE A: travel discovery ---------------- */

  if (!started) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <DiscoveryHero composer={renderComposer("hero")} />
        {renderAttachedNote()}
        {renderError()}

        <div className="mt-4">
          <QuickTiles disabled={loading} onSelect={onFollowUp} />
        </div>

        <div className="mt-8">
          <InspirationGrid />
        </div>

        <div className="mt-4">
          <TrustStrip />
        </div>

        <p className="mt-4 text-xs text-stone-500">
          GhoomAI acts only through verified travel capabilities — bookings are
          always completed by you, externally.
        </p>
      </div>
    );
  }

  /* ---------------- MODE B: active travel workspace ---------------- */

  return (
    <div className="mx-auto w-full max-w-3xl">
      <WorkspaceBanner tripStatus={session.tripStatus} />

      {activeDiscovery && (
        <div className="mt-3">
          <DiscoveryContextHeader
            heading={activeDiscovery.heading}
            prompt={activeDiscovery.prompt}
          />
        </div>
      )}

      <div aria-live="polite" className="mt-4 space-y-5">
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="agent-appear flex justify-end">
              <p className="max-w-[88%] break-words rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[75%]">
                {t.text}
              </p>
            </div>
          ) : (
            <div key={t.id} className="agent-appear flex gap-2.5 sm:gap-3">
              <div
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-900 text-xs font-bold text-white"
              >
                G
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {t.turn && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-900">
                        {intentLabel(t.turn.intent)}
                      </p>
                    )}
                    {t.turn && hasLiveEvidence(t.turn) && <LiveBadge />}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800">
                    {t.text}
                  </p>
                  {t.turn && t.turn.followUps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.turn.followUps.map((suggestion) => (
                        <SuggestionPill
                          key={suggestion}
                          disabled={loading}
                          onSelect={() => onFollowUp(suggestion)}
                        >
                          {suggestion}
                        </SuggestionPill>
                      ))}
                    </div>
                  )}
                  {t.turn && showRealityCheckNudge(t.turn) && (
                    <div className="mt-3 rounded-2xl border border-teal-900/15 bg-teal-50 p-3.5">
                      <p className="text-[13px] text-stone-600">
                        Before you approve it, let&apos;s check the itinerary
                        against live information.
                      </p>
                      <ActionButton
                        type="button"
                        tone="primary"
                        disabled={loading}
                        onClick={() => onFollowUp(REALITYCHECK_NUDGE_MESSAGE)}
                        className="mt-2"
                      >
                        <span aria-hidden="true">✓</span> Run RealityCheck
                      </ActionButton>
                    </div>
                  )}
                </div>
                {t.turn && <AgentResultView turn={t.turn} />}
                {t.turn && requiresApproval(t.turn) && (
                  <AgentCard className="border-amber-200 bg-amber-50/60">
                    <p className="text-sm font-bold text-stone-900">
                      {APPROVAL_CTA.heading}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-700">
                      {APPROVAL_CTA.body}
                    </p>
                    <a
                      href={APPROVAL_CTA.target}
                      aria-label="Open Trip Planner to approve your itinerary"
                      className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-stone-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2"
                    >
                      {APPROVAL_CTA.label}
                    </a>
                    <p className="mt-2 text-xs text-stone-500">
                      {APPROVAL_CTA.returnGuidance}
                    </p>
                  </AgentCard>
                )}
                {t.turn?.confirmationRequired && activeConfirmTurnId === t.id && (
                  <div
                    role="group"
                    aria-label="Confirmation required"
                    className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
                  >
                    <p className="text-sm font-semibold text-amber-900">
                      Confirmation required
                    </p>
                    <p className="mt-1 break-words text-sm leading-relaxed text-amber-900">
                      {t.turn.confirmationRequired.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton
                        type="button"
                        tone="primary"
                        disabled={loading}
                        onClick={() => t.turn && onConfirm(t.turn)}
                      >
                        Confirm
                      </ActionButton>
                      <ActionButton
                        type="button"
                        tone="secondary"
                        disabled={loading}
                        onClick={() => t.turn && onCancel(t.turn)}
                      >
                        Cancel
                      </ActionButton>
                    </div>
                    <p className="mt-2 text-xs text-amber-800">
                      Nothing changes until you confirm.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex gap-2.5 sm:gap-3" aria-label="GhoomAI is working">
            <div
              aria-hidden="true"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-900 text-xs font-bold text-white"
            >
              G
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600 shadow-sm">
              <TypingDots />
              <span>{workingLabel(pendingText)}</span>
            </div>
          </div>
        )}
      </div>

      {renderError()}

      <div className="mt-4">
        {renderComposer("bar")}
        {renderAttachedNote()}
      </div>
      <p className="mt-2 text-xs text-stone-400">
        GhoomAI acts only through verified travel capabilities — bookings are
        always completed by you, externally.
      </p>
    </div>
  );
}
