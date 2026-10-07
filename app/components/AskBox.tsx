"use client";

import { useState, type FormEvent } from "react";
import { postJson } from "./request";
import ResultCards, { type AskResponseData } from "./ResultCards";

/**
 * Single-turn Ask UI. Sends the user's message to our own /api/ask backend
 * only — the browser never touches SerpApi or any API key.
 */

const SUGGESTIONS = [
  "Find good hotels in Jaipur",
  "What are some good places to visit in Jaipur?",
  "Tell me about Jaipur tourism",
];

const INTENT_LABEL: Record<AskResponseData["intent"], string> = {
  find_hotels: "Hotels",
  discover_places: "Places",
  general_search: "Search",
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

export default function AskBox() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskResponseData | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { status, json } = await postJson("/api/ask", {
        message: trimmed,
      });
      if (
        status !== 200 ||
        !isRecord(json) ||
        json.ok !== true ||
        !isRecord(json.data)
      ) {
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      setAnswer(json.data as unknown as AskResponseData);
      // Clear the query only after a successful answer, so a failed
      // request keeps the text for easy retry (Phase 2.5 Fix 4).
      setMessage("");
    } catch (err) {
      setAnswer(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(message);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask about hotels, places, or anything travel…"
          maxLength={500}
          disabled={loading}
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-stone-900 shadow-sm outline-none placeholder:text-stone-400 focus:border-teal-800 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !message.trim()}
          className="shrink-0 rounded-xl bg-stone-900 px-5 py-3 font-medium text-white shadow-sm hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => {
              setMessage(s);
              void ask(s);
            }}
            className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm text-stone-600 hover:border-stone-500 disabled:opacity-60"
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white">
              {INTENT_LABEL[answer.intent]}
            </span>
            {answer.destination && (
              <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-900">
                {answer.destination}
              </span>
            )}
            {answer.dates && (
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">
                {answer.dates.checkIn} → {answer.dates.checkOut}
                {answer.dates.source === "default" ? " · default dates" : ""}
              </span>
            )}
          </div>
          <p className="mt-3 text-stone-700">{answer.message}</p>
          <ResultCards data={answer} />
        </div>
      )}
    </div>
  );
}
