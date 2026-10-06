/**
 * Shared client-side request helper (Phase 11 hardening).
 *
 * Every capability-triggering fetch goes through `postJson` so that:
 * - hung routes cannot spin forever (AbortController timeout),
 * - timeouts surface one deterministic, actionable message,
 * - timers are always cleaned up,
 * - no retries happen in the browser (retry policy belongs server-side),
 * - no credentials are ever handled here (same-origin `/api/*` only).
 *
 * Callers keep their own loading flags and must disable their trigger
 * buttons while a request is in flight to prevent duplicate submissions.
 */

/** Generous enough for bounded SerpApi fan-outs; short enough for demos. */
export const REQUEST_TIMEOUT_MS = 60_000;

export interface PostJsonResult {
  status: number;
  json: unknown;
}

export async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<PostJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(url, {
      method: "POST",
      ...(isForm ? {} : { headers: { "Content-Type": "application/json" } }),
      body: isForm ? (body as FormData) : JSON.stringify(body),
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON responses are handled by the caller's status check.
    }
    return { status: res.status, json };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err instanceof Error ? err : new Error("Request failed.");
  } finally {
    clearTimeout(timer);
  }
}
