/**
 * Unit tests for the OpenAI vision adapter (Phase 8 Prompt 2).
 * Global fetch is stubbed; the fake key below is explicitly test-only.
 * Asserts the real key value never appears in errors or requests logs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError, UpstreamError } from "../src/lib/errors";
import { openaiVisionProvider } from "../src/server/vision/openaiProvider";

const FAKE_KEY = "test-only-openai-key-not-real";
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
}

afterEach(() => {
  setKey(ORIGINAL_KEY);
  vi.unstubAllGlobals();
});

function okResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function completion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("openaiVisionProvider", () => {
  it("requires a configured key", async () => {
    setKey(undefined);
    await expect(
      openaiVisionProvider.analyzeImage({
        image: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  it("sends an authorized vision request and normalizes candidates", async () => {
    setKey(FAKE_KEY);
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        completion(
          JSON.stringify({
            candidates: [
              {
                name: "Synthetic Gate",
                city: "Testville",
                country: "Testland",
                category: "MONUMENT",
                confidence: 0.82,
                visualClues: ["large stone arch"],
              },
            ],
            observations: ["Stone arch."],
            warnings: [],
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await openaiVisionProvider.analyzeImage({
      image: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.openai.com");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: unknown[];
    };
    expect(typeof body.model).toBe("string");
    expect(body.messages).toHaveLength(2);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]?.name).toBe("Synthetic Gate");
    expect(out.candidates[0]?.confidence).toBe(0.82);
  });

  it("maps 401 to an invalid-credentials error without leaking the key", async () => {
    setKey(FAKE_KEY);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({}, 401)));
    const failure = await openaiVisionProvider
      .analyzeImage({ image: new Uint8Array([1]), mimeType: "image/png" })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as Error).message).not.toContain(FAKE_KEY);
  });

  it("converts timeouts and malformed payloads to UpstreamError", async () => {
    setKey(FAKE_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" })),
    );
    await expect(
      openaiVisionProvider.analyzeImage({
        image: new Uint8Array([1]),
        mimeType: "image/webp",
      }),
    ).rejects.toThrow("timed out");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(completion("not-json{{"))),
    );
    await expect(
      openaiVisionProvider.analyzeImage({
        image: new Uint8Array([1]),
        mimeType: "image/webp",
      }),
    ).rejects.toThrow(UpstreamError);
  });
});
