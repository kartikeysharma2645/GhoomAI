/**
 * Route-level tests for POST /api/vision/place (Phase 8 Prompt 2).
 * Vision and SerpApi dependencies are explicitly test-only fakes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/vision/place/route";
import {
  registerVisionProvider,
  unregisterVisionProvider,
} from "../src/server/vision/providers";
import type { SerpApiClient } from "../src/server/services/serpapi/client";

const FAKE_VISION = "test-only-fake-vision-place";
const ORIGINAL_SERPAPI_KEY = process.env.SERPAPI_KEY;

function stubSerpApiKey() {
  process.env.SERPAPI_KEY = "test-only-serpapi-key-not-real";
}

function pngFile(size: number, type = "image/png"): File {
  const header = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const bytes = new Uint8Array(Math.max(size, header.length));
  bytes.set(header);
  return new File([bytes], "test.png", { type });
}

function post(form: FormData): Request {
  return new Request("http://localhost/api/vision/place", {
    method: "POST",
    body: form,
  });
}

function withImage(): FormData {
  const form = new FormData();
  form.append("image", pngFile(64));
  return form;
}

afterEach(() => {
  unregisterVisionProvider(FAKE_VISION);
  // Keep unconfigured-provider tests hermetic even if the ambient
  // environment carries real credentials.
  unregisterVisionProvider("openai-vision");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL_SERPAPI_KEY === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = ORIGINAL_SERPAPI_KEY;
});

describe("POST /api/vision/place", () => {
  it("rejects missing images with 400", async () => {
    const res = await POST(post(new FormData()));
    expect(res.status).toBe(400);
  });

  it("rejects oversized uploads with 413", async () => {
    const form = new FormData();
    form.append("image", pngFile(8_000_001));
    const res = await POST(post(form));
    expect(res.status).toBe(413);
  });

  it("returns a configuration error without a vision provider", async () => {
    const res = await POST(post(withImage()));
    expect(res.status).toBe(500);
  });

  it("returns a verified place without raw payloads or keys", async () => {
    stubSerpApiKey();
    registerVisionProvider({
      name: FAKE_VISION,
      analyzeImage: async () => ({
        candidates: [
          {
            name: "Synthetic Gate",
            city: "Testville",
            country: "Testland",
            confidence: 0.82,
          },
        ],
        observations: [],
        warnings: [],
      }),
    });
    const { SerpApiClient } = await import(
      "../src/server/services/serpapi/client"
    );
    const mapsSpy = vi
      .spyOn(SerpApiClient.prototype, "searchMaps")
      .mockImplementation(async (input) => {
        const q = (input as { query?: string }).query ?? "";
        if (q.includes("near")) {
          return {
            engine: "google_maps",
            query: q,
            resultCount: 1,
            results: [
              { position: 1, title: "Nearby Museum", rating: 4.2 },
            ],
          };
        }
        return {
          engine: "google_maps",
          query: q,
          resultCount: 1,
          results: [
            {
              position: 1,
              title: "Synthetic Gate",
              placeId: "ChXsynthetic",
              rating: 4.6,
              address: "1 Test Road",
            },
          ],
        };
      });
    const searchSpy = vi
      .spyOn(SerpApiClient.prototype, "search")
      .mockResolvedValue({
        engine: "google",
        query: "q",
        resultCount: 1,
        results: [
          {
            position: 1,
            title: "Synthetic Gate tourism",
            link: "https://example.invalid/gate",
            snippet: "Synthetic Gate is a famous monument.",
          },
        ],
      });
    const res = await POST(post(withImage()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        verification: { status: string };
        explanation: { culturalContext: string };
        nearby: Array<{ name: string }>;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.verification.status).toBe("VERIFIED");
    expect(json.data.nearby.map((n) => n.name)).toContain("Nearby Museum");
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("SERPAPI");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("local_results");
    expect(serialized).not.toContain("organic_results");
    expect(mapsSpy).toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalled();
  });
});
