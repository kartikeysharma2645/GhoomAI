/**
 * Unit tests for TripRequirements resolution.
 * Pure validation logic — no network, no live data.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/lib/errors";
import { resolveRequirements } from "../src/server/trips/requirements";

const NOW = new Date("2026-10-04T00:00:00.000Z");

function base() {
  return {
    destination: "Jaipur",
    startDate: "2026-11-10",
    endDate: "2026-11-13",
    adults: 2,
  };
}

describe("requirements validation", () => {
  it("accepts a valid trip", () => {
    const res = resolveRequirements(base(), NOW);
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.requirements.destination).toBe("Jaipur");
    expect(res.requirements.durationDays).toBe(4);
    expect(res.requirements.dateMode).toBe("fixed");
  });

  it("rejects invalid date formats as needs_input", () => {
    const res = resolveRequirements(
      { ...base(), startDate: "10-11-2026" },
      NOW,
    );
    expect(res.status).toBe("needs_input");
    if (res.status !== "needs_input") return;
    expect(res.missing).toContain("startDate");
  });

  it("rejects impossible calendar dates as needs_input", () => {
    const res = resolveRequirements(
      { ...base(), startDate: "2026-02-31" },
      NOW,
    );
    expect(res.status).toBe("needs_input");
  });

  it("rejects end date on or before start date", () => {
    const same = resolveRequirements(
      { ...base(), endDate: "2026-11-10" },
      NOW,
    );
    expect(same.status).toBe("needs_input");
    const before = resolveRequirements(
      { ...base(), startDate: "2026-11-13", endDate: "2026-11-10" },
      NOW,
    );
    expect(before.status).toBe("needs_input");
  });

  it("requests destination when missing", () => {
    const res = resolveRequirements(
      { startDate: "2026-11-10", endDate: "2026-11-13" },
      NOW,
    );
    expect(res.status).toBe("needs_input");
    if (res.status !== "needs_input") return;
    expect(res.missing).toEqual(["destination"]);
  });

  it("requests dates when missing", () => {
    const res = resolveRequirements({ destination: "Jaipur" }, NOW);
    expect(res.status).toBe("needs_input");
    if (res.status !== "needs_input") return;
    expect(res.missing).toContain("startDate");
    expect(res.missing).toContain("endDate");
  });

  it("rejects past trips", () => {
    const res = resolveRequirements(
      {
        destination: "Jaipur",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      },
      NOW,
    );
    expect(res.status).toBe("needs_input");
  });

  it("throws on children/childrenAges mismatch", () => {
    expect(() =>
      resolveRequirements({ ...base(), children: 2, childrenAges: [5] }, NOW),
    ).toThrow(ValidationError);
  });

  it("accepts matching children/ages", () => {
    const res = resolveRequirements(
      { ...base(), children: 1, childrenAges: [7] },
      NOW,
    );
    expect(res.status).toBe("ready");
  });

  it("defaults budget currency to INR", () => {
    const res = resolveRequirements(
      { ...base(), budget: { amount: 25000 } },
      NOW,
    );
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.requirements.budget).toEqual({
      amount: 25000,
      currency: "INR",
    });
  });

  it("records defaults as assumptions", () => {
    const res = resolveRequirements(
      { destination: "Jaipur", startDate: "2026-11-10", endDate: "2026-11-12" },
      NOW,
    );
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.requirements.adults).toBe(2);
    expect(res.requirements.pace).toBe("balanced");
    expect(res.assumptions).toContain("Assuming 2 adults.");
    expect(res.assumptions).toContain("Assuming balanced pace.");
  });

  it("supports flexible dates with duration", () => {
    const res = resolveRequirements(
      { destination: "Jaipur", flexibleDates: true, durationDays: 4 },
      NOW,
    );
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.requirements.dateMode).toBe("flexible");
    expect(res.requirements.durationDays).toBe(4);
    expect(res.requirements.startDate).toBeUndefined();
  });

  it("asks for durationDays in flexible mode without duration", () => {
    const res = resolveRequirements(
      { destination: "Jaipur", flexibleDates: true },
      NOW,
    );
    expect(res.status).toBe("needs_input");
    if (res.status !== "needs_input") return;
    expect(res.missing).toEqual(["durationDays"]);
  });
});
