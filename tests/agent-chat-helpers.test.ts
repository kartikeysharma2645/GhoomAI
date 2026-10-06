import { describe, expect, it } from "vitest";
import {
  APPROVAL_CTA,
  buildConfirmPayload,
  cancelPayload,
  isAcceptedImage,
  requiresApproval,
} from "../app/components/agentChatHelpers";

describe("agent chat helpers", () => {
  it("builds an activation confirm payload", () => {
    expect(
      buildConfirmPayload({
        intent: "activate_trip",
        confirmationRequired: {
          action: "activate_trip",
          summary: "Start?",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toEqual({ action: "activate_trip" });
  });

  it("builds fix/reschedule payloads from server proposal data", () => {
    const proposal = { changes: [{ itemId: "d1-a1" }, { itemId: "stay" }] };
    expect(
      buildConfirmPayload({
        intent: "fix_trip",
        data: { proposal },
        confirmationRequired: {
          action: "apply_fix",
          summary: "Apply?",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toEqual({ action: "apply_fix", changeIds: ["d1-a1", "stay"], proposal });
    expect(
      buildConfirmPayload({
        intent: "reschedule_advice",
        data: { proposal },
        confirmationRequired: {
          action: "apply_reschedule",
          summary: "Apply?",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toEqual({ action: "apply_reschedule", changeIds: ["d1-a1", "stay"], proposal });
  });

  it("builds booking selection payloads from server option data", () => {
    const option = { optionId: "d1-a1:google:x", itemId: "d1-a1" };
    expect(
      buildConfirmPayload({
        intent: "booking_select",
        data: { itemId: "d1-a1", option },
        confirmationRequired: {
          action: "booking_select",
          summary: "Use it?",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toEqual({ action: "booking_select", itemId: "d1-a1", option });
  });

  it("returns null when no confirmation or malformed data", () => {
    expect(buildConfirmPayload({ intent: "plan_trip", data: {} })).toBeNull();
    expect(
      buildConfirmPayload({
        intent: "activate_trip",
        confirmationRequired: {
          action: "launch_rockets",
          summary: "x",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toBeNull();
    expect(
      buildConfirmPayload({
        intent: "fix_trip",
        data: {},
        confirmationRequired: {
          action: "apply_fix",
          summary: "x",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toBeNull();
    expect(
      buildConfirmPayload({
        intent: "fix_trip",
        data: { proposal: { changes: [{ noid: 1 }] } },
        confirmationRequired: {
          action: "apply_fix",
          summary: "x",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toBeNull();
    expect(
      buildConfirmPayload({
        intent: "booking_select",
        data: { itemId: "d1-a1" },
        confirmationRequired: {
          action: "booking_select",
          summary: "x",
          requestedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    ).toBeNull();
  });

  it("builds cancel payloads and validates images", () => {
    expect(cancelPayload("activate_trip")).toEqual({ action: "activate_trip" });
    expect(isAcceptedImage({ type: "image/jpeg", size: 100 })).toBe(true);
    expect(isAcceptedImage({ type: "image/gif", size: 100 })).toBe(false);
    expect(isAcceptedImage({ type: "image/png", size: 9_000_000 })).toBe(false);
    expect(isAcceptedImage({ type: "image/png", size: 0 })).toBe(false);
  });

  it("flags approval-required booking turns for the Trip Planner CTA", () => {
    // booking_discover clarification without result data → approval CTA.
    expect(
      requiresApproval({ intent: "booking_discover", outcome: "clarification" }),
    ).toBe(true);
    expect(
      requiresApproval({
        intent: "booking_recheck",
        outcome: "clarification",
        data: {},
      }),
    ).toBe(true);
  });

  it("flags router-level approval gating for the Trip Planner CTA", () => {
    // The router gates before classification: unapproved booking turns
    // arrive as needs_clarification carrying the exact gate message.
    expect(
      requiresApproval({
        intent: "needs_clarification",
        outcome: "clarification",
        message:
          "Booking discovery needs an approved itinerary. Approve your trip plan first, then ask me to find booking options.",
      }),
    ).toBe(true);
    expect(
      requiresApproval({
        intent: "needs_clarification",
        outcome: "clarification",
        message: "The final pre-trip check needs an approved itinerary.",
      }),
    ).toBe(true);
    // Any other clarification wording gets no CTA.
    expect(
      requiresApproval({
        intent: "needs_clarification",
        outcome: "clarification",
        message: "There is no itinerary to check yet.",
      }),
    ).toBe(false);
    expect(
      requiresApproval({ intent: "needs_clarification", outcome: "clarification" }),
    ).toBe(false);
  });

  it("does not flag unrelated or completed turns for the approval CTA", () => {
    // Completed discovery already has options — no approval CTA.
    expect(
      requiresApproval({
        intent: "booking_discover",
        outcome: "completed",
        data: { discovery: { items: [] } },
      }),
    ).toBe(false);
    // Clarification carrying result data is not an approval gate.
    expect(
      requiresApproval({
        intent: "booking_discover",
        outcome: "clarification",
        data: { discovery: { items: [] } },
      }),
    ).toBe(false);
    // Other intents never trigger the approval CTA.
    for (const intent of [
      "plan_trip",
      "check_trip",
      "fix_trip",
      "booking_select",
      "activate_trip",
      "trip_status",
      "needs_clarification",
      "out_of_scope",
    ]) {
      expect(requiresApproval({ intent, outcome: "clarification" })).toBe(false);
      expect(requiresApproval({ intent, outcome: "completed" })).toBe(false);
    }
  });

  it("renders human-readable approval guidance, not internal identifiers", () => {
    // APPROVAL_CTA is the exact copy the chat renders for the approval card.
    expect(APPROVAL_CTA.target).toBe("/plan");
    expect(APPROVAL_CTA.label).toBe("Open Trip Planner to Approve →");
    for (const text of [
      APPROVAL_CTA.heading,
      APPROVAL_CTA.body,
      APPROVAL_CTA.returnGuidance,
      APPROVAL_CTA.label,
    ]) {
      expect(text).not.toMatch(/APPROVED|BOOKING|EXTERNAL|booking_discover|needs_clarification/);
    }
    expect(APPROVAL_CTA.body).toContain("will not approve it for you");
    expect(APPROVAL_CTA.returnGuidance).toContain("Find booking options");
  });
});
