/**
 * Unit tests for the vision provider boundary (Phase 8 Prompt 1).
 * The fake provider below is explicitly test-only and never ships.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationError, UpstreamError, VisionNotConfiguredError } from "../src/lib/errors";
import {
  getVisionProvider,
  registerVisionProvider,
  unregisterVisionProvider,
  type VisionProvider,
} from "../src/server/vision/providers";
import { analyzeImage } from "../src/server/vision/service";
import { openaiVisionProvider } from "../src/server/vision/openaiProvider";

const FAKE_NAME = "test-only-fake-vision";

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
}

function fakeProvider(
  output: unknown,
  failWith?: Error,
): VisionProvider {
  return {
    name: FAKE_NAME,
    analyzeImage: async () => {
      if (failWith) throw failWith;
      return output as {
        candidates: Array<{ name: string; confidence: number }>;
        observations: string[];
        warnings: string[];
      };
    },
  };
}

afterEach(() => {
  unregisterVisionProvider(FAKE_NAME);
});

describe("provider registry", () => {
  it("treats unconfigured vision as a configuration error", () => {
    const err = new VisionNotConfiguredError();
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.code).toBe("VISION_NOT_CONFIGURED");
    expect(err.message).toMatch(/no vision provider is configured/i);
  });
  it("throws ConfigurationError when no provider is configured", () => {
    unregisterVisionProvider("openai-vision");
    unregisterVisionProvider(FAKE_NAME);
    try {
      expect(() => getVisionProvider()).toThrow(ConfigurationError);
    } finally {
      registerVisionProvider(openaiVisionProvider);
    }
  });

  it("resolves a registered provider", () => {
    registerVisionProvider(fakeProvider({ candidates: [], observations: [], warnings: [] }));
    expect(getVisionProvider().name).toBe(FAKE_NAME);
  });
});

describe("analyzeImage", () => {
  it("fails with ConfigurationError when unconfigured", async () => {
    await expect(analyzeImage({ bytes: jpeg() })).rejects.toThrow(
      ConfigurationError,
    );
  });

  it("normalizes a successful provider response", async () => {
    registerVisionProvider(
      fakeProvider({
        candidates: [
          { name: "Synthetic Fort", type: "MONUMENT", confidence: 0.9 },
        ],
        observations: ["Stone walls on a hill."],
        warnings: [],
        rawDebugBlob: "must be dropped",
      }),
    );
    const res = await analyzeImage({
      bytes: jpeg(),
      declaredMimeType: "image/jpeg",
    });
    expect(res.status).toBe("IDENTIFIED");
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.confidence).toBe(0.9);
    expect(JSON.stringify(res)).not.toContain("rawDebugBlob");
  });

  it("derives LIKELY and UNCERTAIN bands from confidence", async () => {
    registerVisionProvider(
      fakeProvider({
        candidates: [{ name: "Maybe Place", confidence: 0.65 }],
        observations: [],
        warnings: [],
      }),
    );
    const likely = await analyzeImage({ bytes: jpeg() });
    expect(likely.status).toBe("LIKELY");
    unregisterVisionProvider(FAKE_NAME);
    registerVisionProvider(
      fakeProvider({
        candidates: [{ name: "Vague Place", confidence: 0.3 }],
        observations: [],
        warnings: [],
      }),
    );
    const uncertain = await analyzeImage({ bytes: jpeg() });
    expect(uncertain.status).toBe("UNCERTAIN");
  });

  it("returns UNIDENTIFIED for empty candidates", async () => {
    registerVisionProvider(
      fakeProvider({ candidates: [], observations: [], warnings: [] }),
    );
    const res = await analyzeImage({ bytes: jpeg() });
    expect(res.status).toBe("UNIDENTIFIED");
  });

  it("converts provider failures to UpstreamError", async () => {
    registerVisionProvider(fakeProvider({}, new Error("boom")));
    await expect(analyzeImage({ bytes: jpeg() })).rejects.toThrow(
      UpstreamError,
    );
  });

  it("converts malformed provider output to UpstreamError", async () => {
    registerVisionProvider(fakeProvider({ candidates: "nonsense" }));
    await expect(analyzeImage({ bytes: jpeg() })).rejects.toThrow(
      UpstreamError,
    );
  });

  it("drops invalid candidates instead of failing", async () => {
    registerVisionProvider(
      fakeProvider({
        candidates: [
          { name: "", confidence: 0.9 },
          { name: "Good Place", confidence: 0.7 },
          { name: "Overconfident", confidence: 2 },
        ],
        observations: [],
        warnings: [],
      }),
    );
    const res = await analyzeImage({ bytes: jpeg() });
    expect(res.candidates.map((c) => c.name)).toEqual(["Good Place"]);
  });
});
