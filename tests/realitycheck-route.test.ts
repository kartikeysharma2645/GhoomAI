/**
 * Route-level tests for POST /api/trips/reality-check.
 * Validation paths only — these never reach the network.
 * Live behavior is verified separately against real SerpApi.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/reality-check/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/reality-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/trips/reality-check validation", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it("rejects a missing plan with 400", async () => {
    const res = await POST(post(JSON.stringify({})));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid plan with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: { destination: "Jaipur" } })),
    );
    expect(res.status).toBe(400);
  });
});
