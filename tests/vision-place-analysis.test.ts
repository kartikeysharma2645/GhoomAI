/**
 * Unit tests for visual place analysis orchestration (Phase 8 Prompt 2).
 * Vision provider and SerpApi gateway are both replaced with explicitly
 * labeled fakes. No real places are asserted as fact — fixtures use
 * synthetic names, and live behavior is verified separately.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { analyzeVisualPlace } from "../src/server/vision/placeAnalysis";
import {
  registerVisionProvider,
  unregisterVisionProvider,
} from "../src/server/vision/providers";

const FAKE_VISION = "test-only-fake-vision-place";

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
}

function registerVision(candidates: unknown[]) {
  registerVisionProvider({
    name: FAKE_VISION,
    analyzeImage: async () => ({
      candidates: candidates as Array<{ name: string; confidence: number }>,
      observations: ["Synthetic observation."],
      warnings: [],
    }),
  });
}

function fakeClient(maps: unknown[][], search: unknown[][]) {
  let mapsCalls = 0;
  let searchCalls = 0;
  return {
    calls: {
      get maps() {
        return mapsCalls;
      },
      get search() {
        return searchCalls;
      },
    },
    searchMaps: vi.fn().mockImplementation(() => {
      const payload = maps[Math.min(mapsCalls, maps.length - 1)] ?? [];
      mapsCalls += 1;
      return Promise.resolve({
        engine: "google_maps",
        query: "q",
        resultCount: (payload as unknown[]).length,
        results: payload,
      });
    }),
    search: vi.fn().mockImplementation(() => {
      const payload = search[Math.min(searchCalls, search.length - 1)] ?? [];
      searchCalls += 1;
      return Promise.resolve({
        engine: "google",
        query: "q",
        resultCount: (payload as unknown[]).length,
        results: payload,
      });
    }),
    searchHotels: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const CANDIDATE = {
  name: "Synthetic Gate",
  city: "Testville",
  country: "Testland",
  confidence: 0.82,
};

const MAPS_MATCH = {
  position: 1,
  title: "Synthetic Gate",
  placeId: "ChXsynthetic",
  rating: 4.6,
  reviews: 1200,
  address: "1 Test Road",
};

const SEARCH_HIT = {
  position: 1,
  title: "Synthetic Gate — Testville tourism",
  link: "https://example.invalid/gate",
  snippet: "Synthetic Gate is a famous monument in Testville with a long history.",
};

afterEach(() => {
  unregisterVisionProvider(FAKE_VISION);
});

const NEARBY_MUSEUM = {
  position: 2,
  title: "Nearby Museum",
  rating: 4.2,
};

describe("analyzeVisualPlace", () => {
  it("verifies when Maps and Search agree", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient(
      [[MAPS_MATCH], [MAPS_MATCH, NEARBY_MUSEUM]],
      [[SEARCH_HIT]],
    );
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("VERIFIED");
    expect(res.verification.matchedPlace?.name).toBe("Synthetic Gate");
    expect(res.verification.evidence.length).toBeGreaterThan(1);
    expect(res.explanation.fullyVerified).toBe(true);
    expect(res.explanation.sources).toContain("https://example.invalid/gate");
    expect(res.nearby.length).toBeGreaterThan(0);
  });

  it("partially verifies on a single signal", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([[MAPS_MATCH]], [[]]);
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("PARTIALLY_VERIFIED");
    expect(res.explanation.fullyVerified).toBe(false);
  });

  it("reports UNVERIFIED when neither signal exists", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([[]], [[]]);
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("UNVERIFIED");
    expect(res.nearby).toEqual([]);
  });

  it("caps verification at two candidates", async () => {
    registerVision([
      { ...CANDIDATE, name: "Gate One", confidence: 0.9 },
      { ...CANDIDATE, name: "Gate Two", confidence: 0.8 },
      { ...CANDIDATE, name: "Gate Three", confidence: 0.7 },
    ]);
    const fake = fakeClient([[MAPS_MATCH]], [[SEARCH_HIT]]);
    await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    // One Maps + one Search call per verified candidate (max 2).
    expect(fake.calls.search).toBeLessThanOrEqual(2);
  });

  it("excludes the verified place from nearby results", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient(
      [
        [MAPS_MATCH],
        [
          { position: 1, title: "Synthetic Gate", rating: 4.6 },
          { position: 2, title: "Nearby Museum", rating: 4.2 },
        ],
      ],
      [[SEARCH_HIT]],
    );
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.nearby.map((n) => n.name)).toContain("Nearby Museum");
    expect(res.nearby.map((n) => n.name)).not.toContain("Synthetic Gate");
  });

  it("returns UNVERIFIED without SerpApi calls when vision is empty", async () => {
    registerVision([]);
    const fake = fakeClient([[MAPS_MATCH]], [[SEARCH_HIT]]);
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("UNVERIFIED");
    expect(fake.calls.maps).toBe(0);
    expect(fake.calls.search).toBe(0);
  });

  it("keeps vision confidence separate from verification", async () => {
    registerVision([{ ...CANDIDATE, confidence: 0.99 }]);
    const fake = fakeClient([[]], [[]]);
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.visual.candidates[0]).toMatchObject({ confidence: 0.99 });
    expect(res.verification.status).toBe("UNVERIFIED");
  });
});
