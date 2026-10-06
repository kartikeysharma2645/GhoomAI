/**
 * Integration tests for photography + photo spots in visual place
 * analysis (Phase 8 Prompt 3). Fakes are explicitly test-only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { analyzeVisualPlace } from "../src/server/vision/placeAnalysis";
import {
  registerVisionProvider,
  unregisterVisionProvider,
} from "../src/server/vision/providers";

const FAKE_VISION = "test-only-fake-vision-photo";

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
}

function registerVision(candidates: unknown[]) {
  registerVisionProvider({
    name: FAKE_VISION,
    analyzeImage: async () => ({
      candidates: candidates as Array<{ name: string; confidence: number }>,
      observations: ["Tall stone arch, centered."],
      warnings: [],
    }),
  });
}

function fakeClient(mapsPools: unknown[][], searchPools: unknown[][] = [[
      {
        position: 1,
        title: "Synthetic Gate tourism",
        link: "https://example.invalid/gate",
        snippet: "Synthetic Gate is a famous monument.",
      },
    ]]) {
  let calls = 0;
  let searchCalls = 0;
  return {
    get calls() {
      return calls;
    },
    searchMaps: vi.fn().mockImplementation(() => {
      const payload = mapsPools[Math.min(calls, mapsPools.length - 1)] ?? [];
      calls += 1;
      return Promise.resolve({
        engine: "google_maps",
        query: "q",
        resultCount: (payload as unknown[]).length,
        results: payload,
      });
    }),
    search: vi.fn().mockImplementation(() => {
      const payload =
        searchPools[Math.min(searchCalls, searchPools.length - 1)] ?? [];
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
  confidence: 0.85,
};

const MATCH = {
  position: 1,
  title: "Synthetic Gate",
  placeId: "ChXsynthetic",
  rating: 4.6,
  reviews: 800,
};

const VIEWPOINT = {
  position: 1,
  title: "Hill Viewpoint",
  rating: 4.3,
  reviews: 200,
};

afterEach(() => {
  unregisterVisionProvider(FAKE_VISION);
});

describe("photography integration", () => {
  it("attaches grounded advice and live photo spots", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([[MATCH], [VIEWPOINT]]);
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("VERIFIED");
    expect(res.photography).toBeDefined();
    expect(res.photography?.advice.subject).toBe("Synthetic Gate");
    expect(res.photography?.advice.groundedIn).toBe("verified_place");
    expect(res.photography?.photoSpots.map((s) => s.name)).toContain(
      "Hill Viewpoint",
    );
    const spot = res.photography?.photoSpots.find(
      (s) => s.name === "Hill Viewpoint",
    );
    expect(spot?.corroborated).toBe(false);
    expect(spot?.reason).toContain("lead");
  });

  it("marks advice visual-only when verification fails", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([[]], []);
    // search mock returns a hit above; override with empty for this case
    (fake.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      engine: "google",
      query: "q",
      resultCount: 0,
      results: [],
    });
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.verification.status).toBe("UNVERIFIED");
    expect(res.photography?.advice.groundedIn).toBe("visual_only");
    expect(res.photography?.photoSpots).toEqual([]);
  });

  it("omits photo spots when Maps fails but keeps advice", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([[MATCH]]);
    let calls = 0;
    (fake.searchMaps as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls += 1;
      if (calls <= 2) {
        const pools = [[MATCH], [MATCH]];
        const payload = pools[Math.min(calls - 1, pools.length - 1)] ?? [];
        return Promise.resolve({
          engine: "google_maps",
          query: "q",
          resultCount: (payload as unknown[]).length,
          results: payload,
        });
      }
      return Promise.reject(new Error("down"));
    });
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    expect(res.photography?.advice.subject).toBe("Synthetic Gate");
    expect(res.photography?.photoSpots).toEqual([]);
    expect(res.warnings.some((w) => w.includes("Photo-spot"))).toBe(true);
  });

  it("corroborates spots mentioned in search evidence", async () => {
    registerVision([CANDIDATE]);
    const fake = fakeClient([
      [MATCH],
      [{ position: 1, title: "Synthetic Gate Viewpoint", rating: 4.1 }],
    ]);
    (fake.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      engine: "google",
      query: "q",
      resultCount: 1,
      results: [
        {
          position: 1,
          title: "Synthetic Gate tourism",
          link: "https://example.invalid/gate",
          snippet: "Visit Synthetic Gate Viewpoint at sunset for photos.",
        },
      ],
    });
    const res = await analyzeVisualPlace({ bytes: jpeg(), client: asClient(fake) });
    const spot = res.photography?.photoSpots.find(
      (s) => s.name === "Synthetic Gate Viewpoint",
    );
    expect(spot?.corroborated).toBe(true);
  });
});
