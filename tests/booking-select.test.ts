/**
 * Phase 9 Prompt 2 selection tests: server-side validation of the
 * resubmitted option plus the select route contract. No network.
 */
import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../src/lib/errors";
import { optionFromMapsPlace } from "../src/server/booking/discovery";
import { validateSelection } from "../src/server/booking/selection";
import type { BookingOption } from "../src/server/booking/types";
import type { TripPlan } from "../src/server/trips/plan";
import { POST } from "../app/api/trips/booking-select/route";

const NOW = new Date("2026-10-06T00:00:00.000Z");

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
          title: "Synthetic Fort",
          place: { name: "Synthetic Fort" },
          evidence: [],
        },
      ],
      dayCost: { lines: [], currency: "INR" },
    },
  ],
  totals: { lines: [], currency: "INR" },
  pricesVerified: true,
} as unknown as TripPlan;

function mapsOption(): BookingOption {
  return optionFromMapsPlace({
    itemId: "d1-a1",
    place: {
      position: 1,
      title: "Synthetic Fort",
      placeId: "ChX1",
      links: { website: "https://fort.example.com/info" },
    },
    sentQuery: "Synthetic Fort Jaipur",
    purpose: "attraction",
    observedAt: NOW.toISOString(),
    leadType: "CORROBORATED",
  });
}

function post(body: string): Request {
  return new Request("http://localhost/api/trips/booking-select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("validateSelection", () => {
  it("accepts a consistent option and returns an EXTERNAL receipt", () => {
    const selection = validateSelection({
      plan: PLAN,
      status: "APPROVED",
      itemId: "d1-a1",
      option: mapsOption(),
      now: NOW,
    });
    expect(selection.handoffType).toBe("EXTERNAL");
    expect(selection.url).toBe("https://fort.example.com/info");
    expect(selection.selectedAt).toBe(NOW.toISOString());
    expect(selection.note).toMatch(/did not complete any booking/i);
  });

  it("rejects unknown or ineligible items (stale discovery)", () => {
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "nope", option: mapsOption(), now: NOW }),
    ).toThrow(ValidationError);
  });

  it("rejects options belonging to another item", () => {
    const option = { ...mapsOption(), itemId: "d1-other" };
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option, now: NOW }),
    ).toThrow(ValidationError);
  });

  it("rejects tampered option ids", () => {
    const option = { ...mapsOption(), optionId: "d1-a1:google_maps:forged" };
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option, now: NOW }),
    ).toThrow(ValidationError);
  });

  it("rejects arbitrary client URLs swapped onto an option", () => {
    const option = { ...mapsOption(), url: "https://evil.example/phish" };
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option, now: NOW }),
    ).toThrow(/evidence/i);
  });

  it("rejects non-http(s) urls", () => {
    const base = mapsOption();
    const option: BookingOption = {
      ...base,
      url: "javascript:alert(1)",
      evidence: { ...base.evidence, sourceUrl: "javascript:alert(1)" },
    };
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option, now: NOW }),
    ).toThrow(ValidationError);
  });

  it("rejects future evidence timestamps", () => {
    const base = mapsOption();
    const option: BookingOption = {
      ...base,
      observedAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    };
    expect(() =>
      validateSelection({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option, now: NOW }),
    ).toThrow(ValidationError);
  });

  it("requires an APPROVED trip", () => {
    expect(() =>
      validateSelection({ plan: PLAN, status: "PLANNED", itemId: "d1-a1", option: mapsOption(), now: NOW }),
    ).toThrow(ConflictError);
  });
});

describe("POST /api/trips/booking-select", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects invalid option payloads with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option: { optionId: "x" } })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects selection on a non-ready trip with 409", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "PLANNED", itemId: "d1-a1", option: mapsOption() })),
    );
    expect(res.status).toBe(409);
  });

  it("rejects stale item ids with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", itemId: "stale", option: mapsOption() })),
    );
    expect(res.status).toBe(400);
  });

  it("returns an EXTERNAL receipt without any booking claim", async () => {
    const res = await POST(
      post(JSON.stringify({ plan: PLAN, status: "APPROVED", itemId: "d1-a1", option: mapsOption() })),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        selection: { handoffType: string; url: string | null };
        booking: { performed: boolean; bookingId: null; confirmationCode: null };
        disclaimer: string;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.selection.handoffType).toBe("EXTERNAL");
    expect(json.data.selection.url).toBe("https://fort.example.com/info");
    expect(json.data.booking).toEqual({ performed: false, bookingId: null, confirmationCode: null });
    const serialized = JSON.stringify(json.data).toLowerCase();
    expect(serialized).not.toContain("booking confirmed");
    expect(serialized).not.toContain("confirmed booking");
  });
});
