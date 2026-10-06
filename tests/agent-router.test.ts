/**
 * Phase 10 Prompt 1 router tests: deterministic extended intent taxonomy.
 * Pure routing only — no network, no execution, no session mutation.
 * Phase 3 behavior is preserved by delegation; agent-intent tests cover it.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/lib/errors";
import {
  contextFromSession,
  resolveAgentIntent,
  type RoutingContextInput,
} from "../src/server/agent/router";
import { createEmptySession } from "../src/server/agent/session";

const PLAN_CTX: RoutingContextInput = { hasActivePlan: true, tripStatus: "PLANNED" };
const APPROVED_CTX: RoutingContextInput = { hasActivePlan: true, tripStatus: "APPROVED" };
const ACTIVE_CTX: RoutingContextInput = {
  hasActivePlan: true,
  tripStatus: "ACTIVE",
  hasActiveTrip: true,
};
const OPTIONS_CTX: RoutingContextInput = {
  ...APPROVED_CTX,
  hasBookingOptions: true,
};

describe("resolveAgentIntent capability routing", () => {
  it("routes the spec examples to their intents", () => {
    expect(resolveAgentIntent("Find hotels in Jaipur").intent).toBe("find_hotels");
    expect(resolveAgentIntent("Show me places to visit in Jaipur").intent).toBe(
      "discover_places",
    );
    expect(resolveAgentIntent("Plan me 3 days in Jaipur").intent).toBe("plan_trip");
    expect(
      resolveAgentIntent("Check if my itinerary is realistic", PLAN_CTX).intent,
    ).toBe("check_trip");
    expect(
      resolveAgentIntent("Fix the problems in my itinerary", PLAN_CTX).intent,
    ).toBe("fix_trip");
    expect(
      resolveAgentIntent("Find booking options for my hotel", APPROVED_CTX).intent,
    ).toBe("booking_discover");
    expect(resolveAgentIntent("Use this option", OPTIONS_CTX).intent).toBe(
      "booking_select",
    );
    expect(
      resolveAgentIntent("Check my plan again before the trip", PLAN_CTX).intent,
    ).toBe("booking_recheck");
    expect(resolveAgentIntent("Start my trip", APPROVED_CTX).intent).toBe(
      "activate_trip",
    );
    expect(
      resolveAgentIntent("Where am I in my itinerary?", ACTIVE_CTX).intent,
    ).toBe("trip_progress");
    expect(
      resolveAgentIntent("Something changed, help me reschedule", ACTIVE_CTX).intent,
    ).toBe("reschedule_advice");
    expect(resolveAgentIntent("What is this monument?").intent).toBe(
      "identify_place",
    );
  });

  it("preserves Phase 3 search behavior through delegation", () => {
    const hotels = resolveAgentIntent("Find good hotels in Jaipur");
    expect(hotels.intent).toBe("find_hotels");
    expect(hotels.engine).toBe("google_hotels");
    expect(hotels.destination).toBe("Jaipur");
    const places = resolveAgentIntent("What are some good places to visit in Jaipur?");
    expect(places.intent).toBe("discover_places");
    expect(places.engine).toBe("google_maps");
    const general = resolveAgentIntent("Tell me about Jaipur tourism");
    expect(general.intent).toBe("general_search");
    expect(general.engine).toBe("google");
  });

  it("asks for clarification when context is missing", () => {
    const check = resolveAgentIntent("Check it");
    expect(check.intent).toBe("needs_clarification");
    expect(check.missing).toContain("active_plan");
    expect(
      resolveAgentIntent("Check it", PLAN_CTX).intent,
    ).toBe("check_trip");

    const select = resolveAgentIntent("Use the second one");
    expect(select.intent).toBe("needs_clarification");
    expect(select.missing).toContain("booking_options");
    expect(
      resolveAgentIntent("Use the second one", OPTIONS_CTX).intent,
    ).toBe("booking_select");

    const noDestination = resolveAgentIntent("Plan a trip for me");
    expect(noDestination.intent).toBe("needs_clarification");
    expect(noDestination.missing).toContain("destination");

    const activate = resolveAgentIntent("Start my trip", PLAN_CTX);
    expect(activate.intent).toBe("needs_clarification");
    expect(activate.missing).toContain("approvable_plan");

    const discover = resolveAgentIntent("Find booking options", PLAN_CTX);
    expect(discover.intent).toBe("needs_clarification");
    expect(discover.missing).toContain("approved_plan");

    const progress = resolveAgentIntent("What's next?", PLAN_CTX);
    expect(progress.intent).toBe("needs_clarification");
    expect(progress.missing).toContain("active_trip");
  });

  it("routes unrelated input to out_of_scope, never a guessed action", () => {
    for (const message of [
      "Write a poem about the sea",
      "Write Python code to sort a list",
      "Tell me a joke",
    ]) {
      const routed = resolveAgentIntent(message);
      expect(routed.intent).toBe("out_of_scope");
      expect(routed.missing).toEqual([]);
      expect(routed.clarification).toMatch(/travel/i);
    }
  });

  it("routes low-confidence gibberish to out_of_scope", () => {
    expect(resolveAgentIntent("asdkfjhasd qwer zxcv").intent).toBe("out_of_scope");
  });

  it("keeps trip_status and trip_progress distinct", () => {
    expect(
      resolveAgentIntent("What is my trip status?", ACTIVE_CTX).intent,
    ).toBe("trip_status");
    expect(
      resolveAgentIntent("What is my current day?", ACTIVE_CTX).intent,
    ).toBe("trip_progress");
  });

  it("rejects empty and over-long messages like Phase 3", () => {
    expect(() => resolveAgentIntent("   ")).toThrow(ValidationError);
    expect(() => resolveAgentIntent("x".repeat(501))).toThrow(ValidationError);
  });

  it("derives routing context from a session without guessing", () => {
    const empty = contextFromSession(createEmptySession());
    expect(empty).toMatchObject({
      hasActivePlan: false,
      hasActiveTrip: false,
      hasBookingOptions: false,
    });
    expect(() => contextFromSession({} as never)).toThrow(ValidationError);
  });
});
