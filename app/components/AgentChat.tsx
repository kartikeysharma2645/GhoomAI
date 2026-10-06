"use client";

import { useRef, useState, type FormEvent } from "react";
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

const inputCls =
  "min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-sky-600 disabled:opacity-60";

export default function AgentChat() {
  const [session, setSession] = useState<SessionState>(FRESH_SESSION);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const attached = image ? { base64: image.base64, mimeType: image.mimeType } : null;
    void send(input, undefined, attached);
    setInput("");
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
  }

  return (
    <div>
      <div aria-live="polite" className="space-y-4">
        {turns.length === 0 && (
          <p className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-600 shadow-sm">
            Tell me where you want to go — I can plan the trip, verify it
            against live information, find booking options, and track you
            while you travel. I only act through verified capabilities, and
            consequential steps always ask first.
          </p>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-sm">
                {t.text}
              </p>
            </div>
          ) : (
            <div key={t.id} className="space-y-2">
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                {t.turn && (
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sky-700">
                    {intentLabel(t.turn.intent)}
                  </p>
                )}
                <p className="text-sm text-neutral-800">{t.text}</p>
                {t.turn && t.turn.followUps.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {t.turn.followUps.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={loading}
                        onClick={() => onFollowUp(suggestion)}
                        className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {t.turn && <AgentResultView turn={t.turn} />}
              {t.turn && requiresApproval(t.turn) && (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-bold text-neutral-900">
                    {APPROVAL_CTA.heading}
                  </p>
                  <p className="mt-1 text-sm text-neutral-700">
                    {APPROVAL_CTA.body}
                  </p>
                  <a
                    href={APPROVAL_CTA.target}
                    aria-label="Open Trip Planner to approve your itinerary"
                    className="mt-3 inline-block rounded-xl bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                  >
                    {APPROVAL_CTA.label}
                  </a>
                  <p className="mt-2 text-xs text-neutral-500">
                    {APPROVAL_CTA.returnGuidance}
                  </p>
                </div>
              )}
              {t.turn?.confirmationRequired && activeConfirmTurnId === t.id && (
                <div
                  role="group"
                  aria-label="Confirmation required"
                  className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
                >
                  <p className="text-sm font-medium text-amber-900">
                    Confirmation required
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    {t.turn.confirmationRequired.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => t.turn && onConfirm(t.turn)}
                      className="rounded-xl bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => t.turn && onCancel(t.turn)}
                      className="rounded-xl border border-neutral-300 bg-white px-5 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-500 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <p>{error}</p>
          {sessionBroken && (
            <button
              type="button"
              onClick={restart}
              className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Start a new conversation
            </button>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <label htmlFor="agent-message" className="sr-only">
          Message GhoomAI
        </label>
        <input
          id="agent-message"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Plan a trip, check it, find options…"
          maxLength={500}
          disabled={loading}
          autoComplete="off"
          className={inputCls}
        />
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
          className="shrink-0 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-700 shadow-sm hover:border-neutral-500 disabled:opacity-50"
        >
          📷
        </button>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="shrink-0 rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white shadow-sm hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Send"}
        </button>
      </form>
      {image && (
        <p className="mt-2 text-xs text-neutral-600">
          Attached: {image.name} (sent with your next message, never stored).
          <button
            type="button"
            onClick={() => setImage(null)}
            className="ml-2 underline hover:text-neutral-900"
          >
            Remove
          </button>
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        GhoomAI acts only through verified travel capabilities — bookings are
        always completed by you, externally.
      </p>
    </div>
  );
}
