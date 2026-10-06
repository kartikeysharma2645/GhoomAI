/**
 * Service-wiring tests for POST /api/trips/booking-select.
 *
 * Purpose: prove request → readiness gate → validateSelection invocation →
 * response mapping. The service is faked at the route boundary; implementation
 * coverage lives in booking-select.test.ts. No network, no booking.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ValidationError } from "../src/lib/errors";

vi.mock("../src/server/booking/selection", () => ({
  validateSelection: vi.fn(),
}));

import { validateSelection } from "../src/server/booking/selection";
import { POST } from "../app/api/trips/booking-select/route";

const mockValidate = vi.mocked(validateSelection);

function post(body: string): Request {
  return new Request("http://localhost/api/trips/booking-select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const PLAN = {
  destination: "Jaipur",
  dateMode: "fixed",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  durationDays: 3,
  party: { adults: 2, children: 0 },
  budgetVerdict: "within",
  assumptions: [],
  warnings: [],
  days: [
    {
      dayNumber: 1,
      date: "2026-11-10",
      items: [
        {
          id: "d1-a1",
          kind: "attraction",
          title: "Old Fort",
          place: { name: "Old Fort" },
          evidence: [],
        },
      ],
      dayCost: { lines: [], currency: "INR" },
    },
  ],
  totals: { lines: [], currency: "INR" },
  pricesVerified: true,
};

const OPTION = {
  optionId: "d1-a1:google_maps:ChX1",
  itemId: "d1-a1",
  title: "Old Fort",
  provider: "Google Maps",
  leadType: "CORROBORATED",
  handoffType: "EXTERNAL",
  evidence: {
    engine: "google_maps",
    observedAt: "2026-11-09T00:00:00.000Z",
    placeId: "ChX1",
    facts: {},
  },
  observedAt: "2026-11-09T00:00:00.000Z",
};

describe("POST /api/trips/booking-select wiring", () => {
  beforeEach(() => {
    mockValidate.mockClear();
  });
  it("invokes validateSelection on a READY trip and maps the receipt", async () => {
    const selection = {
      itemId: "d1-a1",
      optionId: OPTION.optionId,
      title: "Old Fort",
      provider: "Google Maps",
      url: null,
      handoffType: "EXTERNAL",
      selectedAt: "2026-11-09T01:00:00.000Z",
      note: "Selected for external handoff.",
    };
    mockValidate.mockReturnValueOnce(selection as never);
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option: OPTION })),
    );
    expect(res.status).toBe(200);
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockValidate).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "d1-a1", status: "APPROVED" }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: { selection: unknown; booking: { performed: boolean } };
    };
    expect(json.ok).toBe(true);
    expect(json.data.selection).toEqual(selection);
    expect(json.data.booking.performed).toBe(false);
  });

  it("maps service validation errors to 400 without calling twice", async () => {
    mockValidate.mockImplementationOnce(() => {
      throw new ValidationError("Unknown or ineligible handoff item.");
    });
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", itemId: "nope", option: OPTION })),
    );
    expect(res.status).toBe(400);
    expect(mockValidate).toHaveBeenCalledTimes(1);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});
