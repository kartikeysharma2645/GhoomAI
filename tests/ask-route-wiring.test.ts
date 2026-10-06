/**
 * Service-wiring tests for POST /api/ask.
 *
 * Purpose: prove request → validation → executeIntent invocation →
 * response mapping. The service itself is faked at the route boundary;
 * implementation coverage lives in agent-responder.test.ts. No network.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UpstreamError } from "../src/lib/errors";

vi.mock("../src/server/agent/responder", () => ({
  executeIntent: vi.fn(),
}));

import { executeIntent } from "../src/server/agent/responder";
import { POST } from "../app/api/ask/route";

const mockExecute = vi.mocked(executeIntent);

function post(body: string): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/ask wiring", () => {
  beforeEach(() => {
    mockExecute.mockClear();
  });
  it("invokes executeIntent with the resolved intent and maps the result", async () => {
    mockExecute.mockResolvedValueOnce({
      intent: "discover_places",
      engine: "google_maps",
      message: "Found 2 places in Jaipur.",
      destination: "Jaipur",
      resultCount: 1,
      results: [{ position: 1, title: "Old Fort" }],
    });
    const res = await POST(post(JSON.stringify({ message: "places to visit in Jaipur" })));
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const intent = mockExecute.mock.calls[0]?.[0] as { intent?: string; query?: string } | undefined;
    expect(intent?.intent).toBe("discover_places");
    expect(intent?.query).toContain("Jaipur");
    const json = (await res.json()) as { ok: boolean; data: { message: string; resultCount: number } };
    expect(json.ok).toBe(true);
    expect(json.data.message).toBe("Found 2 places in Jaipur.");
    expect(json.data.resultCount).toBe(1);
  });

  it("propagates service errors with safe mapping", async () => {
    mockExecute.mockRejectedValueOnce(new UpstreamError("Search provider is unreachable."));
    const res = await POST(post(JSON.stringify({ message: "hotels in Jaipur" })));
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UPSTREAM_ERROR");
  });
});
