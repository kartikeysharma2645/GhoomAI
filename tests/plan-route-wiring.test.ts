/**
 * Service-wiring tests for POST /api/trips/plan.
 *
 * Purpose: prove request → validation → planTrip invocation → response
 * mapping. The service is faked at the route boundary; implementation
 * coverage lives in trips-service.test.ts. No network.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ValidationError } from "../src/lib/errors";

vi.mock("../src/server/trips/service", () => ({
  planTrip: vi.fn(),
}));

import { planTrip } from "../src/server/trips/service";
import { POST } from "../app/api/trips/plan/route";

const mockPlanTrip = vi.mocked(planTrip);

function post(body: string): Request {
  return new Request("http://localhost/api/trips/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const REQUEST = {
  destination: "Jaipur",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  adults: 2,
};

describe("POST /api/trips/plan wiring", () => {
  beforeEach(() => {
    mockPlanTrip.mockClear();
  });
  it("invokes planTrip with the validated request and maps the result", async () => {
    const plan = { destination: "Jaipur", days: [] };
    mockPlanTrip.mockResolvedValueOnce({ status: "ready", plan } as never);
    const res = await POST(post(JSON.stringify(REQUEST)));
    expect(res.status).toBe(200);
    expect(mockPlanTrip).toHaveBeenCalledTimes(1);
    expect(mockPlanTrip).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "Jaipur", adults: 2 }),
    );
    const json = (await res.json()) as { ok: boolean; data: { status: string; plan: unknown } };
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ready");
    expect(json.data.plan).toEqual(plan);
  });

  it("forwards needs_input results unchanged", async () => {
    mockPlanTrip.mockResolvedValueOnce({
      status: "needs_input",
      missing: ["startDate"],
      message: "Add dates.",
    });
    const res = await POST(post(JSON.stringify({ destination: "Jaipur" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { status: string } };
    expect(json.data.status).toBe("needs_input");
  });

  it("maps service validation errors to 400", async () => {
    mockPlanTrip.mockRejectedValueOnce(new ValidationError("Invalid trip request."));
    const res = await POST(post(JSON.stringify(REQUEST)));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});
