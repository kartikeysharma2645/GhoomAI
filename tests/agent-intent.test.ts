/**
 * Unit tests for the Phase 3 deterministic intent router.
 * Pure functions only — no network, no mocks, no live data.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/lib/errors";
import {
  extractDestination,
  resolveIntent,
} from "../src/server/agent/intent";

// Fixed clock so dynamic default dates are deterministic.
const FIXED_NOW = new Date("2026-10-04T00:00:00.000Z");
const DEFAULT_IN = "2026-11-03";
const DEFAULT_OUT = "2026-11-06";

describe("intent classification", () => {
  it("classifies hotel requests as find_hotels / google_hotels", () => {
    const intent = resolveIntent("Find good hotels in Jaipur", {}, FIXED_NOW);
    expect(intent.intent).toBe("find_hotels");
    expect(intent.engine).toBe("google_hotels");
  });

  it("classifies place discovery as discover_places / google_maps", () => {
    const intent = resolveIntent(
      "What are some good places to visit in Jaipur?",
      {},
      FIXED_NOW,
    );
    expect(intent.intent).toBe("discover_places");
    expect(intent.engine).toBe("google_maps");
  });

  it("falls back to general_search / google", () => {
    const intent = resolveIntent("Tell me about Jaipur tourism", {}, FIXED_NOW);
    expect(intent.intent).toBe("general_search");
    expect(intent.engine).toBe("google");
  });

  it("selects the correct engine for every intent", () => {
    expect(
      resolveIntent("hotels in Jaipur", {}, FIXED_NOW).engine,
    ).toBe("google_hotels");
    expect(
      resolveIntent("places to visit in Jaipur", {}, FIXED_NOW).engine,
    ).toBe("google_maps");
    expect(resolveIntent("Jaipur weather", {}, FIXED_NOW).engine).toBe(
      "google",
    );
  });
});

describe("destination extraction", () => {
  it("extracts Jaipur", () => {
    expect(extractDestination("Find good hotels in Jaipur")).toBe("Jaipur");
    expect(
      resolveIntent("Find good hotels in Jaipur", {}, FIXED_NOW).destination,
    ).toBe("Jaipur");
  });

  it("extracts another destination", () => {
    expect(extractDestination("Show me resorts in Udaipur")).toBe("Udaipur");
    expect(extractDestination("tourist attractions near New Delhi")).toBe(
      "New Delhi",
    );
  });

  it("does not invent a destination for ambiguous queries", () => {
    const intent = resolveIntent("Find good hotels", {}, FIXED_NOW);
    expect(intent.destination).toBeUndefined();
    expect(intent.intent).toBe("find_hotels");
    expect(intent.query).toBe("Find good hotels");
  });

  it("extracts destinations after 'to' without shadowing", () => {
    expect(
      extractDestination(
        "Plan a 3-day trip to Jaipur for 2 adults with a budget of ₹20,000. We love history and food.",
      ),
    ).toBe("Jaipur");
    expect(
      extractDestination("I want to spend 3 days in Jaipur with two adults"),
    ).toBe("Jaipur");
    expect(extractDestination("Find hotels to visit in Udaipur")).toBe("Udaipur");
  });

  it("extracts a bare destination after 'plan' with no preposition", () => {
    expect(
      extractDestination("Help me plan Jaipur for 3 days for two people"),
    ).toBe("Jaipur");
  });

  it("still refuses to invent a destination", () => {
    expect(extractDestination("Plan a trip for me")).toBeUndefined();
    expect(extractDestination("Plan a 3-day trip")).toBeUndefined();
    expect(extractDestination("I want to travel somewhere nice")).toBeUndefined();
  });
});

describe("hotel dates", () => {
  it("generates the dynamic default window", () => {
    const intent = resolveIntent("Find good hotels in Jaipur", {}, FIXED_NOW);
    expect(intent.checkIn).toBe(DEFAULT_IN);
    expect(intent.checkOut).toBe(DEFAULT_OUT);
    expect(intent.datesSource).toBe("default");
  });

  it("marks datesSource as default", () => {
    const intent = resolveIntent("hotels in Jaipur", {}, FIXED_NOW);
    expect(intent.datesSource).toBe("default");
  });

  it("uses valid user-provided dates", () => {
    const intent = resolveIntent(
      "Find good hotels in Jaipur",
      { checkIn: "2026-12-01", checkOut: "2026-12-05" },
      FIXED_NOW,
    );
    expect(intent.checkIn).toBe("2026-12-01");
    expect(intent.checkOut).toBe("2026-12-05");
    expect(intent.datesSource).toBe("user");
  });

  it("falls back to defaults when user dates are invalid", () => {
    const intent = resolveIntent(
      "Find good hotels in Jaipur",
      { checkIn: "2026-02-31", checkOut: "2026-12-05" },
      FIXED_NOW,
    );
    expect(intent.checkIn).toBe(DEFAULT_IN);
    expect(intent.datesSource).toBe("default");
  });
});

describe("message validation", () => {
  it("rejects empty messages", () => {
    expect(() => resolveIntent("", {}, FIXED_NOW)).toThrow(ValidationError);
    expect(() => resolveIntent("   ", {}, FIXED_NOW)).toThrow(
      ValidationError,
    );
  });

  it("rejects very long messages", () => {
    expect(() => resolveIntent("x".repeat(501), {}, FIXED_NOW)).toThrow(
      ValidationError,
    );
  });
});
