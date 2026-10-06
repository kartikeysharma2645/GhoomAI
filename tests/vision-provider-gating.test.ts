/**
 * Unit tests for vision provider configuration gating (Phase 8 Prompt 4).
 * Uses dynamic imports with an isolated module registry so the
 * import-time registration gate can be observed directly.
 * No real credentials are used anywhere.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  vi.resetModules();
});

describe("vision provider gating", () => {
  it("registers OpenAI only when credentials exist", async () => {
    process.env.OPENAI_API_KEY = "test-only-key-not-real";
    const providers = await import("../src/server/vision/providers");
    await import("../src/server/vision/service");
    expect(providers.getVisionProvider().name).toBe("openai-vision");
  });

  it("leaves the registry empty without credentials", async () => {
    delete process.env.OPENAI_API_KEY;
    const providers = await import("../src/server/vision/providers");
    await import("../src/server/vision/service");
    let code: string | undefined;
    let name: string | undefined;
    try {
      providers.getVisionProvider();
    } catch (err) {
      code = (err as { code?: string }).code;
      name = (err as Error).name;
    }
    expect(code).toBe("VISION_NOT_CONFIGURED");
    expect(name).toBe("VisionNotConfiguredError");
  });
});
