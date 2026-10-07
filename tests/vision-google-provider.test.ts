/**
 * Unit tests for the Google Cloud Vision landmark adapter.
 * The Google SDK is never touched: a fake landmark client is injected,
 * and only explicitly test-only shapes are used. No network, no credentials.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "../src/lib/errors";
import {
  createGoogleCloudVisionProvider,
  GOOGLE_VISION_PROVIDER_NAME,
  isGoogleCloudVisionEnabled,
  mapGoogleVisionError,
  toProviderCandidates,
  type LandmarkDetectionClient,
} from "../src/server/vision/googleCloudProvider";

function fakeClient(
  respond: unknown,
  failWith?: unknown,
): LandmarkDetectionClient & {
  landmarkDetection: { mock: { calls: unknown[][] } };
} {
  return {
    landmarkDetection: vi.fn().mockImplementation(() =>
      failWith !== undefined ? Promise.reject(failWith) : Promise.resolve(respond),
    ),
  } as LandmarkDetectionClient & {
    landmarkDetection: { mock: { calls: unknown[][] } };
  };
}

const IMAGE = { image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" as const };

const INDIA_GATE_RESPONSE = [
  {
    landmarkAnnotations: [
      {
        description: "India Gate",
        score: 0.958,
        locations: [{ latLng: { latitude: 28.6129, longitude: 77.2295 } }],
      },
    ],
  },
];

describe("toProviderCandidates", () => {
  it("maps a valid landmark with coordinates, keeping rank", () => {
    const out = toProviderCandidates([
      {
        description: "India Gate",
        score: 0.958,
        locations: [{ latLng: { latitude: 28.6129, longitude: 77.2295 } }],
      },
      { description: "Rajpath", score: 0.41 },
    ]);
    expect(out).toEqual([
      { name: "India Gate", type: "LANDMARK", confidence: 0.958 },
      { name: "Rajpath", type: "LANDMARK", confidence: 0.41 },
    ]);
  });

  it("drops malformed, blank, and out-of-range annotations", () => {
    expect(
      toProviderCandidates([
        { description: "", score: 0.9 },
        { description: "No Score" },
        { description: "Too Sure", score: 1.4 },
        { description: "Negative", score: -0.2 },
        { description: "NaN", score: NaN },
        null,
        "nonsense",
      ]),
    ).toEqual([]);
    expect(toProviderCandidates(undefined)).toEqual([]);
    expect(toProviderCandidates({})).toEqual([]);
  });

  it("caps very long names and candidate counts", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      description: `Place ${i} ${"x".repeat(250)}`,
      score: 0.9,
    }));
    const out = toProviderCandidates(many);
    expect(out).toHaveLength(10);
    expect(out[0]?.name.length).toBeLessThanOrEqual(200);
  });
});

describe("mapGoogleVisionError", () => {
  it("maps auth failures to credential rejection without details", () => {
    for (const code of [16, "UNAUTHENTICATED", 7, "PERMISSION_DENIED"]) {
      const err = mapGoogleVisionError({ code, message: "SECRET-ACCOUNT-DATA" });
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.message).toMatch(/rejected the configured credentials/i);
      expect(err.message).not.toContain("SECRET-ACCOUNT-DATA");
    }
  });

  it("maps billing-disabled projects to an actionable billing error", () => {
    const err = mapGoogleVisionError({
      code: 7,
      details:
        "This API method requires billing to be enabled. Please enable billing on the project.",
    });
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/billing is not enabled/i);
    expect(err.status).toBe(403);
  });

  it("maps rate limits and unknown failures safely", () => {
    const limited = mapGoogleVisionError({ code: 8 });
    expect(limited.message).toMatch(/rate limit/i);
    expect(limited.status).toBe(429);
    const generic = mapGoogleVisionError(new Error("boom"));
    expect(generic).toBeInstanceOf(UpstreamError);
    expect(generic.message).not.toContain("boom");
  });
});

describe("createGoogleCloudVisionProvider", () => {
  it("sends in-memory bytes and returns mapped candidates", async () => {
    const client = fakeClient(INDIA_GATE_RESPONSE);
    const provider = createGoogleCloudVisionProvider({
      createClient: () => client,
    });
    expect(provider.name).toBe(GOOGLE_VISION_PROVIDER_NAME);
    const out = await provider.analyzeImage(IMAGE);
    expect(client.landmarkDetection).toHaveBeenCalledTimes(1);
    const sent = client.landmarkDetection.mock.calls[0]?.[0] as {
      image?: { content?: unknown };
    };
    const content = sent?.image?.content;
    expect(Buffer.from(content as Uint8Array).equals(Buffer.from(IMAGE.image))).toBe(true);
    expect(out.candidates).toEqual([
      { name: "India Gate", type: "LANDMARK", confidence: 0.958 },
    ]);
    expect(out.observations).toEqual([]);
  });

  it("returns zero candidates on empty annotations (never a guess)", async () => {
    const client = fakeClient([{ landmarkAnnotations: [] }]);
    const provider = createGoogleCloudVisionProvider({
      createClient: () => client,
    });
    const out = await provider.analyzeImage(IMAGE);
    expect(out.candidates).toEqual([]);
  });

  it("converts API failures to safe upstream errors", async () => {
    const client = fakeClient(null, { code: 16, message: "bad-key-material" });
    const provider = createGoogleCloudVisionProvider({
      createClient: () => client,
    });
    const err = await provider.analyzeImage(IMAGE).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as Error).message).toMatch(/rejected the configured credentials/i);
    expect((err as Error).message).not.toContain("bad-key-material");
  });

  it("converts embedded per-image errors honestly", async () => {
    const client = fakeClient([{ error: { code: 7, message: "denied" } }]);
    const provider = createGoogleCloudVisionProvider({
      createClient: () => client,
    });
    await expect(provider.analyzeImage(IMAGE)).rejects.toThrow(
      /rejected the configured credentials/i,
    );
  });
});

describe("isGoogleCloudVisionEnabled", () => {
  const ORIGINAL_PROVIDER = process.env.VISION_PROVIDER;
  const ORIGINAL_FLAG = process.env.GOOGLE_CLOUD_VISION_ENABLED;
  const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (ORIGINAL_PROVIDER === undefined) delete process.env.VISION_PROVIDER;
    else process.env.VISION_PROVIDER = ORIGINAL_PROVIDER;
    if (ORIGINAL_FLAG === undefined) delete process.env.GOOGLE_CLOUD_VISION_ENABLED;
    else process.env.GOOGLE_CLOUD_VISION_ENABLED = ORIGINAL_FLAG;
    if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
    vi.resetModules();
  });

  it("opts in explicitly and stays off by default", async () => {
    delete process.env.VISION_PROVIDER;
    delete process.env.GOOGLE_CLOUD_VISION_ENABLED;
    expect(isGoogleCloudVisionEnabled()).toBe(false);

    process.env.VISION_PROVIDER = "google";
    expect(isGoogleCloudVisionEnabled()).toBe(true);

    process.env.VISION_PROVIDER = "openai";
    delete process.env.GOOGLE_CLOUD_VISION_ENABLED;
    expect(isGoogleCloudVisionEnabled()).toBe(false);

    delete process.env.VISION_PROVIDER;
    process.env.GOOGLE_CLOUD_VISION_ENABLED = "1";
    expect(isGoogleCloudVisionEnabled()).toBe(true);
  });

  it("registers Google last (preferred) only when enabled", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.GOOGLE_CLOUD_VISION_ENABLED = "1";
    delete process.env.VISION_PROVIDER;
    const providers = await import("../src/server/vision/providers");
    await import("../src/server/vision/service");
    expect(providers.getVisionProvider().name).toBe(GOOGLE_VISION_PROVIDER_NAME);
    providers.unregisterVisionProvider(GOOGLE_VISION_PROVIDER_NAME);
  });

  it("keeps VISION_NOT_CONFIGURED when nothing is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_CLOUD_VISION_ENABLED;
    delete process.env.VISION_PROVIDER;
    const providers = await import("../src/server/vision/providers");
    await import("../src/server/vision/service");
    let code: string | undefined;
    try {
      providers.getVisionProvider();
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("VISION_NOT_CONFIGURED");
  });

  it("respects an explicit openai preference over the enable flag", async () => {
    process.env.OPENAI_API_KEY = "test-only-key-not-real";
    process.env.GOOGLE_CLOUD_VISION_ENABLED = "1";
    process.env.VISION_PROVIDER = "openai";
    const providers = await import("../src/server/vision/providers");
    await import("../src/server/vision/service");
    expect(providers.getVisionProvider().name).toBe("openai-vision");
    providers.unregisterVisionProvider("openai-vision");
    delete process.env.OPENAI_API_KEY;
  });
});

describe("google provider service integration", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("flows mapped candidates through analyzeImage validation", async () => {
    const providers = await import("../src/server/vision/providers");
    const service = await import("../src/server/vision/service");
    const client = fakeClient(INDIA_GATE_RESPONSE);
    providers.registerVisionProvider(
      createGoogleCloudVisionProvider({ createClient: () => client }),
    );
    try {
      const res = await service.analyzeImage({
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x10]),
        declaredMimeType: "image/jpeg",
      });
      expect(res.status).toBe("IDENTIFIED");
      expect(res.candidates[0]).toMatchObject({ name: "India Gate" });
    } finally {
      providers.unregisterVisionProvider(GOOGLE_VISION_PROVIDER_NAME);
      providers.unregisterVisionProvider("openai-vision");
    }
  });
});
