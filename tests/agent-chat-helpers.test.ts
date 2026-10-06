import { describe, expect, it } from "vitest";
import {
  buildConfirmPayload,
  cancelPayload,
  isAcceptedImage,
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
});
