/**
 * Regression tests for the Phase 2.5 functional stabilization fixes.
 * Pure/server + static-markup tests only — no network, no DOM.
 *
 * - Fix 1: location-aware discovery context + honest broad-scope wording.
 * - Fix 2: place "Plan a trip here" built from real result data.
 * - Fix 3: booking_select router guard (place language no longer collides).
 * - Fix 4 (AskBox clears input on success) is interactive and has no DOM
 *   available in this suite (no jsdom/happy-dom dependency); it is covered
 *   by manual smoke instead. Nothing here weakens existing tests.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { orchestrateTurn } from "../src/server/agent/orchestrator";
import { resolveAgentIntent } from "../src/server/agent/router";
import {
  conversationSessionSchema,
  createEmptySession,
  type ConversationSession,
} from "../src/server/agent/session";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import AgentResultView from "../app/components/AgentResultView";
import { buildPlanHereMessage } from "../app/components/ResultCards";

const NOW = new Date("2026-10-06T00:00:00.000Z");

function mapsFake(captured: { input?: unknown }) {
  return {
    searchMaps: vi.fn().mockImplementation((input: unknown) => {
      captured.input = input;
      return Promise.resolve({
        engine: "google_maps",
        query: "q",
        resultCount: 1,
        results: [{ position: 1, title: "Synthetic Heritage Hall" }],
      });
    }),
    searchHotels: vi.fn(),
    search: vi.fn(),
  };
}

function asClient(fake: unknown): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const SEARCH_FIXTURES = {
  maps: [{ position: 1, title: "Synthetic Fort", placeId: "ChX1" }],
  hotels: [{ position: 1, name: "Synthetic Grand", propertyToken: "tok1" }],
};

function planningFake() {
  return {
    searchMaps: vi.fn().mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: SEARCH_FIXTURES.maps.length,
      results: SEARCH_FIXTURES.maps,
    }),
    searchHotels: vi.fn().mockResolvedValue({
      engine: "google_hotels",
      query: "q",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      currency: "INR",
      resultCount: SEARCH_FIXTURES.hotels.length,
      results: SEARCH_FIXTURES.hotels,
    }),
    search: vi.fn(),
  };
}

describe("Fix 1: location-aware discovery context", () => {
  it("marks fresh generic discovery as broad/global", async () => {
    const captured: { input?: unknown } = {};
    const res = await orchestrateTurn(
      createEmptySession(),
      "Show me heritage destinations worth visiting",
      undefined,
      { now: NOW, client: asClient(mapsFake(captured)) },
    );
    expect(res.intent).toBe("discover_places");
    expect(res.outcome).toBe("completed");
    expect(res.message).toMatch(/broad travel ideas/i);
    expect(res.message).toMatch(/name a destination or region/i);
    // No context exists, so no location bias is sent — honestly global.
    expect(captured.input).toMatchObject({ location: undefined });
  });

  it("reuses the active plan destination for discovery location", async () => {
    const planned = await orchestrateTurn(
      createEmptySession(),
      "Plan 3 flexible days in Jaipur",
      undefined,
      { now: NOW, client: asClient(planningFake()) },
    );
    expect(planned.outcome).toBe("completed");
    expect(planned.session.activePlan?.destination).toBe("Jaipur");

    const captured: { input?: unknown } = {};
    const res = await orchestrateTurn(
      planned.session,
      "Show me heritage destinations worth visiting",
      undefined,
      { now: NOW, client: asClient(mapsFake(captured)) },
    );
    expect(res.intent).toBe("discover_places");
    expect(captured.input).toMatchObject({ location: "Jaipur" });
    // Scoped search carries no broad/global disclaimer.
    expect(res.message).not.toMatch(/broad travel ideas/i);
  });

  it("reuses the user's own partial planning destination", async () => {
    const session: ConversationSession = conversationSessionSchema.parse({
      sessionVersion: 1,
      transcript: [],
      tripStatus: "DRAFT",
      pendingPlanRequest: { destination: "Goa" },
    });
    const captured: { input?: unknown } = {};
    const res = await orchestrateTurn(
      session,
      "Show me lake destinations worth visiting",
      undefined,
      { now: NOW, client: asClient(mapsFake(captured)) },
    );
    expect(res.intent).toBe("discover_places");
    expect(captured.input).toMatchObject({ location: "Goa" });
    expect(res.message).not.toMatch(/broad travel ideas/i);
  });
});

const OPTIONS_CTX = {
  hasActivePlan: true,
  tripStatus: "APPROVED",
  hasBookingOptions: true,
} as const;

describe("Fix 3: booking_select router guard", () => {
  it.each([
    "I choose this Cherokee Heritage Center",
    "select this place",
    "pick this destination",
    "I want this place",
  ])("place language '%s' never becomes booking_select", (message) => {
    expect(resolveAgentIntent(message).intent).not.toBe("booking_select");
    expect(resolveAgentIntent(message, OPTIONS_CTX).intent).not.toBe(
      "booking_select",
    );
  });

  it.each([
    "use the first option",
    "use the second one",
    "choose option 1",
    "select the third option",
    "use the first booking option",
    "Use this option",
  ])("legitimate selection '%s' still reaches booking_select", (message) => {
    expect(resolveAgentIntent(message, OPTIONS_CTX).intent).toBe(
      "booking_select",
    );
  });

  it("keeps the no-context clarification for genuine option language", () => {
    const res = resolveAgentIntent("Use the second one");
    expect(res.intent).toBe("needs_clarification");
    expect(res.missing).toContain("booking_options");
  });
});

describe("Fix 2: place Plan-a-trip-here action", () => {
  const place = {
    title: "Cherokee Heritage Center",
    address: "Park Hill, OK",
    rating: 4.6,
  };

  function discoverTurn(onAction?: (message: string) => void) {
    return AgentResultView({
      turn: {
        intent: "discover_places",
        outcome: "completed",
        capability: "executeIntent",
        message: "m",
        data: { engine: "google_maps", resultCount: 1, results: [place] },
        followUps: [],
      },
      ...(onAction ? { onAction } : {}),
    }) as unknown as null;
  }

  it("builds the action from the real name and address", () => {
    expect(buildPlanHereMessage(place)).toBe(
      "Plan a trip to Cherokee Heritage Center in Park Hill, OK",
    );
  });

  it("falls back to the name alone rather than inventing geography", () => {
    expect(buildPlanHereMessage({ title: "Mystery Point" })).toBe(
      "Plan a trip to Mystery Point",
    );
  });

  it("returns null with no usable name, so no action renders", () => {
    expect(buildPlanHereMessage({})).toBeNull();
    expect(buildPlanHereMessage({ address: "Nowhere" })).toBeNull();
  });

  it("renders Plan a trip here only where an action handler exists", () => {
    const withAction = renderToStaticMarkup(discoverTurn(() => {}));
    expect(withAction).toContain("Plan a trip here");
    expect(withAction).toContain("Cherokee Heritage Center");
    const withoutAction = renderToStaticMarkup(discoverTurn());
    expect(withoutAction).not.toContain("Plan a trip here");
    expect(withoutAction).toContain("Cherokee Heritage Center");
  });

  it("the built message enters the existing plan_trip capability", () => {
    const message = buildPlanHereMessage(place);
    expect(message).not.toBeNull();
    expect(resolveAgentIntent(message as string).intent).toBe("plan_trip");
  });
});
