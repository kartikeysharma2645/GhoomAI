/**
 * Route-level tests for POST /api/vision/analyze (Phase 8 Prompt 1).
 * The fake provider below is explicitly test-only and never ships.
 */
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/vision/analyze/route";
import {
  registerVisionProvider,
  unregisterVisionProvider,
} from "../src/server/vision/providers";

const FAKE_NAME = "test-only-fake-vision";

function pngFile(size: number, type = "image/png"): File {
  const header = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const bytes = new Uint8Array(Math.max(size, header.length));
  bytes.set(header);
  return new File([bytes], "test.png", { type });
}

function post(form: FormData): Request {
  return new Request("http://localhost/api/vision/analyze", {
    method: "POST",
    body: form,
  });
}

afterEach(() => {
  unregisterVisionProvider(FAKE_NAME);
  // Keep unconfigured-provider tests hermetic even if the ambient
  // environment carries real credentials.
  unregisterVisionProvider("openai-vision");
});

describe("POST /api/vision/analyze", () => {
  it("rejects a missing image with 400", async () => {
    const res = await POST(post(new FormData()));
    expect(res.status).toBe(400);
  });

  it("rejects unsupported MIME types with 400", async () => {
    const form = new FormData();
    form.append(
      "image",
      new File([new Uint8Array([0x47, 0x49, 0x46])], "x.gif", {
        type: "image/gif",
      }),
    );
    const res = await POST(post(form));
    expect(res.status).toBe(400);
  });

  it("rejects oversized uploads with 413", async () => {
    const form = new FormData();
    form.append("image", pngFile(8_000_001));
    const res = await POST(post(form));
    expect(res.status).toBe(413);
  });

  it("returns a configuration error when no provider exists", async () => {
    const form = new FormData();
    form.append("image", pngFile(64));
    const res = await POST(post(form));
    expect(res.status).toBe(500);
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VISION_NOT_CONFIGURED");
    expect(json.error.message).toMatch(/not configured/i);
  });

  it("returns normalized results without raw payloads or image echoes", async () => {
    registerVisionProvider({
      name: FAKE_NAME,
      analyzeImage: async () => ({
        candidates: [
          { name: "Synthetic Fort", type: "MONUMENT", confidence: 0.9 },
        ],
        observations: ["Stone walls."],
        warnings: [],
        secretSauce: "must be dropped",
      }),
    });
    const form = new FormData();
    form.append("image", pngFile(64));
    const res = await POST(post(form));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { status: string; candidates: Array<{ name: string }> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("IDENTIFIED");
    expect(json.data.candidates[0]?.name).toBe("Synthetic Fort");
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("secretSauce");
    expect(serialized).not.toContain("arrayBuffer");
    expect(serialized).not.toContain("SERPAPI");
  });
});
