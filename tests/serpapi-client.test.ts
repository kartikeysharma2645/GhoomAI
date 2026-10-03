/**
 * Unit tests for the server-side SerpApi gateway (Phase 2).
 *
 * Scope: error handling and secret hygiene ONLY.
 * - `fetch` is stubbed ONLY to simulate transport/HTTP failures (network
 *   down, 401, unreadable body). These stubs are explicitly labeled mocks.
 * - No successful SerpApi payload is fabricated here. A successful live
 *   request must be verified manually against the real API (see README flow).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SerpApiClient } from "../src/server/services/serpapi/client";
import {
  ConfigurationError,
  UpstreamError,
  ValidationError,
} from "../src/lib/errors";

// Explicitly labeled mock credential. Never a real key. Used only to assert
// that error paths never leak the key value.
const MOCK_KEY = "test-only-mock-key-not-real-abc123";

const ORIGINAL_KEY = process.env.SERPAPI_KEY;

function setKey(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SERPAPI_KEY;
  } else {
    process.env.SERPAPI_KEY = value;
  }
}

afterEach(() => {
  setKey(ORIGINAL_KEY);
  vi.unstubAllGlobals();
});

describe("SerpApiClient key handling", () => {
  it("throws ConfigurationError when SERPAPI_KEY is missing", () => {
    setKey(undefined);
    expect(() => new SerpApiClient()).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when SERPAPI_KEY is blank", () => {
    setKey("   ");
    expect(() => new SerpApiClient()).toThrow(ConfigurationError);
  });

  it("rejects invalid search input without making a request", async () => {
    setKey(MOCK_KEY);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = new SerpApiClient();
    await expect(client.search({ query: "" })).rejects.toThrow(
      ValidationError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SerpApiClient upstream failures (mocked transport only)", () => {
  it("maps 401 to an invalid-key error that never contains the key", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid API key" }), {
          status: 401,
        }),
      ),
    );
    const client = new SerpApiClient();
    const failure = await client
      .search({ engine: "google", query: "best places to visit Jaipur" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as Error).message).not.toContain(MOCK_KEY);
    expect((failure as Error).message).not.toContain("api_key");
  });

  it("converts network failures to UpstreamError without leaking the key", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const client = new SerpApiClient();
    const failure = await client
      .search({ engine: "google", query: "best places to visit Jaipur" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as Error).message).toBe(
      "Search provider is unreachable.",
    );
    expect((failure as Error).message).not.toContain(MOCK_KEY);
  });

  it("converts timeouts to UpstreamError", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    const client = new SerpApiClient();
    await expect(
      client.search({ engine: "google", query: "best places to visit Jaipur" }),
    ).rejects.toThrow("Search provider request timed out.");
  });

  it("rejects unreadable response bodies as UpstreamError", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("bad json")),
      }),
    );
    const client = new SerpApiClient();
    await expect(
      client.search({ engine: "google", query: "best places to visit Jaipur" }),
    ).rejects.toThrow("unreadable response");
  });
});
