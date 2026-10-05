/**
 * Route-level tests for POST /api/trips/reality-fix.
 * Validation paths only — these never reach the network.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/trips/reality-fix/route";

function post(body: string): Request {
  return new Request("http://localhost/api/trips/reality-fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/trips/reality-fix validation", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it("rejects a missing check with 400", async () => {
    const res = await POST(post(JSON.stringify({ plan: {} })));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid plan with 400", async () => {
    const res = await POST(
      post(
        JSON.stringify({
          plan: { destination: "Jaipur" },
          check: { checkedAt: "x", summary: {}, items: [], warnings: [] },
        }),
      ),
    );
    expect(res.status).toBe(400);
  });
});
