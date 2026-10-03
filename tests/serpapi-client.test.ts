/**
 * Unit tests for the server-side SerpApi gateway (Phase 2).
 *
 * Scope: error handling, secret hygiene, engine acceptance, and pure
 * normalization logic.
 * - `fetch` is stubbed ONLY to simulate transport/HTTP behavior (network
 *   down, 401, unreadable body) or to return EMPTY result shapes
 *   (`{organic_results: []}`, `{local_results: []}`) so tests assert
 *   request construction without any fabricated place data.
 * - `normalizeMapsPlaces` is tested with minimal SYNTHETIC shape probes
 *   (obviously fake values such as "Synthetic Test Place") to prove
 *   optional-field tolerance. These are unit-test-only fixtures, NOT live
 *   data, and they never assert real-world content.
 * - A successful live request must still be verified manually against the
 *   real API via /api/serpapi/test and /api/serpapi/maps-test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SerpApiClient } from "../src/server/services/serpapi/client";
import { normalizeMapsPlaces } from "../src/server/services/serpapi/types";
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

describe("SerpApiClient Google Maps support", () => {
  it("accepts the google_maps engine and sends type=search", async () => {
    setKey(MOCK_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ local_results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SerpApiClient();
    const result = await client.searchMaps({
      query: "tourist attractions in Jaipur",
      location: "Jaipur",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("engine=google_maps");
    expect(url).toContain("type=search");
    expect(result.engine).toBe("google_maps");
    expect(result.query).toBe("tourist attractions in Jaipur");
    expect(result.location).toBe("Jaipur");
    expect(result.resultCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("keeps accepting the google engine (empty-shape probe, no fake data)", async () => {
    setKey(MOCK_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ organic_results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SerpApiClient();
    const result = await client.search({
      engine: "google",
      query: "best places to visit Jaipur",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("engine=google");
    expect(result.resultCount).toBe(0);
  });

  it("rejects invalid maps input without making a request", async () => {
    setKey(MOCK_KEY);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = new SerpApiClient();
    await expect(client.searchMaps({ query: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(client.searchMaps({})).rejects.toThrow(ValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts maps transport failures to UpstreamError without leaking the key", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const client = new SerpApiClient();
    const failure = await client
      .searchMaps({ query: "tourist attractions in Jaipur" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as Error).message).toBe(
      "Search provider is unreachable.",
    );
    expect((failure as Error).message).not.toContain(MOCK_KEY);
  });
});

describe("normalizeMapsPlaces (synthetic shape probes — NOT live data)", () => {  it("normalizes available fields", () => {
    const out = normalizeMapsPlaces("tourist attractions in Jaipur", "Jaipur", {
      local_results: [
        {
          position: 1,
          title: "Synthetic Test Place",
          place_id: "ChXsynthetic000",
          data_cid: "1234567890",
          rating: 4.5,
          reviews: 123,
          price: "$$",
          type: "Tourist attraction",
          address: "1 Test Road, Testville",
          description: "A synthetic probe place.",
          open_state: "Open",
          hours: { Monday: "9:00 AM – 5:00 PM" },
          gps_coordinates: { latitude: 26.9, longitude: 75.8 },
          thumbnail: "https://example.invalid/thumb.jpg",
          links: { website: "https://example.invalid" },
        },
      ],
    });
    expect(out.resultCount).toBe(1);
    const [place] = out.results;
    expect(place.title).toBe("Synthetic Test Place");
    expect(place.placeId).toBe("ChXsynthetic000");
    expect(place.rating).toBe(4.5);
    expect(place.reviews).toBe(123);
    expect(place.price).toBe("$$");
    expect(place.placeType).toBe("Tourist attraction");
    expect(place.address).toBe("1 Test Road, Testville");
    expect(place.openState).toBe("Open");
    expect(place.hours).toEqual({ Monday: "9:00 AM – 5:00 PM" });
    expect(place.gpsCoordinates).toEqual({ latitude: 26.9, longitude: 75.8 });
    expect(place.links).toEqual({ website: "https://example.invalid" });
  });

  it("tolerates missing optional fields", () => {
    const out = normalizeMapsPlaces("tourist attractions in Jaipur", undefined, {
      local_results: [{}],
    });
    expect(out.resultCount).toBe(1);
    expect(out.results[0]).toMatchObject({ position: 1, title: "" });
    expect(out.results[0].rating).toBeUndefined();
    expect(out.results[0].placeId).toBeUndefined();
    expect(out.results[0].hours).toBeUndefined();
    expect(out.location).toBeUndefined();
  });

  it("tolerates empty and absent local_results", () => {
    expect(
      normalizeMapsPlaces("q", undefined, { local_results: [] }).resultCount,
    ).toBe(0);
    expect(normalizeMapsPlaces("q", undefined, {}).results).toEqual([]);
  });

  it("ignores malformed hours/links shapes instead of breaking", () => {
    const out = normalizeMapsPlaces("q", undefined, {
      local_results: [
        {
          title: "Synthetic Odd Shapes",
          hours: ["Monday"],
          links: { website: 42 },
        },
      ],
    });
    expect(out.results[0].title).toBe("Synthetic Odd Shapes");
    expect(out.results[0].hours).toBeUndefined();
    expect(out.results[0].links).toBeUndefined();
  });
});

describe("SerpApiClient maps location/zoom handling (regression)", () => {
  it("sends a default zoom when location is provided (SerpApi requires z/m)", async () => {
    setKey(MOCK_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ local_results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SerpApiClient();
    await client.searchMaps({
      query: "tourist attractions in Jaipur",
      location: "Jaipur",
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("location=Jaipur");
    expect(url).toMatch(/(?:^|[?&])z=\d+/);
  });

  it("sends no zoom when location is absent", async () => {
    setKey(MOCK_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ local_results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SerpApiClient();
    await client.searchMaps({ query: "tourist attractions in Jaipur" });
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(
      /(?:^|[?&])z=\d+/,
    );
  });

  it("honors an explicit zoom over the default", async () => {
    setKey(MOCK_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ local_results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SerpApiClient();
    await client.searchMaps({
      query: "tourist attractions in Jaipur",
      location: "Jaipur",
      zoom: 10,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("z=10");
  });
});

describe("SerpApiClient safe upstream diagnostics", () => {
  it("exposes status and redacted provider error on HTTP 400", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: `bad request, key was ${MOCK_KEY} ok` }),
          { status: 400 },
        ),
      ),
    );
    const client = new SerpApiClient();
    const failure = await client
      .searchMaps({ query: "tourist attractions in Jaipur" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    // User-facing message stays generic.
    expect((failure as Error).message).toBe(
      "Search provider request failed.",
    );
    const details = (failure as UpstreamError).details;
    expect(details?.httpStatus).toBe(400);
    expect(details?.providerError).toContain("[REDACTED]");
    expect(details?.providerError).not.toContain(MOCK_KEY);
  });

  it("redacts the key from 200-status error payloads", async () => {
    setKey(MOCK_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: `Invalid API key ${MOCK_KEY} provided` }),
          { status: 200 },
        ),
      ),
    );
    const client = new SerpApiClient();
    const failure = await client
      .search({ engine: "google", query: "best places to visit Jaipur" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    const details = (failure as UpstreamError).details;
    expect(details?.providerError).toContain("[REDACTED]");
    expect(details?.providerError).not.toContain(MOCK_KEY);
  });
});
