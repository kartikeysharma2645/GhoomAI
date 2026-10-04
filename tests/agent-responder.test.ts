/**
 * Unit tests for the Phase 3 responder/executor.
 *
 * The SerpApiClient is replaced with an explicitly labeled fake that returns
 * minimal EMPTY normalized shapes — no real hotel/place data is fabricated.
 * Live behavior is verified separately via POST /api/ask against real SerpApi.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { executeIntent } from "../src/server/agent/responder";
import { resolveIntent } from "../src/server/agent/intent";

const MOCK_KEY = "test-only-mock-key-not-real-abc123";

function fakeClient() {
  return {
    search: vi.fn().mockResolvedValue({
      engine: "google",
      query: "q",
      resultCount: 1,
      results: [{ position: 1, title: "t", link: "l", snippet: "s" }],
    }),
    searchMaps: vi.fn().mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: 1,
      results: [{ position: 1, title: "t" }],
    }),
    searchHotels: vi.fn().mockImplementation((input: unknown) => {
      const params = input as {
        query: string;
        checkIn: string;
        checkOut: string;
      };
      return Promise.resolve({
        engine: "google_hotels",
        query: params.query,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        currency: "INR",
        resultCount: 1,
        results: [{ position: 1, name: "n" }],
      });
    }),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const FIXED_NOW = new Date("2026-10-04T00:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("responder engine dispatch", () => {
  it("routes find_hotels to searchHotels()", async () => {
    const fake = fakeClient();
    const intent = resolveIntent("Find good hotels in Jaipur", {}, FIXED_NOW);
    const res = await executeIntent(intent, asClient(fake));
    expect(fake.searchHotels).toHaveBeenCalledTimes(1);
    expect(fake.searchMaps).not.toHaveBeenCalled();
    expect(fake.search).not.toHaveBeenCalled();
    expect(res.engine).toBe("google_hotels");
    expect(res.resultCount).toBe(1);
    expect(res.dates?.source).toBe("default");
  });

  it("routes discover_places to searchMaps()", async () => {
    const fake = fakeClient();
    const intent = resolveIntent(
      "What are some good places to visit in Jaipur?",
      {},
      FIXED_NOW,
    );
    const res = await executeIntent(intent, asClient(fake));
    expect(fake.searchMaps).toHaveBeenCalledTimes(1);
    expect(fake.searchHotels).not.toHaveBeenCalled();
    expect(fake.search).not.toHaveBeenCalled();
    expect(res.engine).toBe("google_maps");
    expect(res.results).toHaveLength(1);
  });

  it("routes general_search to search()", async () => {
    const fake = fakeClient();
    const intent = resolveIntent("Tell me about Jaipur tourism", {}, FIXED_NOW);
    const res = await executeIntent(intent, asClient(fake));
    expect(fake.search).toHaveBeenCalledTimes(1);
    expect(fake.searchHotels).not.toHaveBeenCalled();
    expect(fake.searchMaps).not.toHaveBeenCalled();
    expect(res.engine).toBe("google");
  });

  it("returns normalized results with no key material in output", async () => {
    const fake = fakeClient();
    const intent = resolveIntent("Find good hotels in Jaipur", {}, FIXED_NOW);
    const res = await executeIntent(intent, asClient(fake));
    expect(res.results).toEqual([{ position: 1, name: "n" }]);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(MOCK_KEY);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("SERPAPI_KEY");
  });

  it("reports user dates source when caller dates are used", async () => {
    const fake = fakeClient();
    const intent = resolveIntent(
      "Find good hotels in Jaipur",
      { checkIn: "2026-12-01", checkOut: "2026-12-05" },
      FIXED_NOW,
    );
    const res = await executeIntent(intent, asClient(fake));
    expect(res.dates?.source).toBe("user");
    expect(res.dates?.checkIn).toBe("2026-12-01");
  });
});
