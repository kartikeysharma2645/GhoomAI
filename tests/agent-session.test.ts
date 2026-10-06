/**
 * Phase 10 Prompt 1 session tests: client-held conversation contract.
 * Pure validation only — no network, no execution, no persistence.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/lib/errors";
import {
  appendTranscriptEntry,
  conversationSessionSchema,
  createEmptySession,
  MAX_TRANSCRIPT_ENTRIES,
  MAX_TRANSCRIPT_TEXT_LENGTH,
} from "../src/server/agent/session";

describe("conversation session contract", () => {
  it("creates a valid minimal session", () => {
    const session = createEmptySession();
    expect(conversationSessionSchema.safeParse(session).success).toBe(true);
    expect(session.transcript).toEqual([]);
    expect(session.tripStatus).toBe("DRAFT");
  });

  it("accepts a fully populated valid session", () => {
    const session = {
      sessionVersion: 1,
      transcript: [
        {
          role: "user",
          text: "Plan me 3 days in Jaipur",
          createdAt: "2026-10-06T00:00:00.000Z",
        },
        {
          role: "assistant",
          text: "Planned.",
          createdAt: "2026-10-06T00:01:00.000Z",
          action: { capability: "plan_trip", status: "completed" },
        },
      ],
      tripStatus: "PLANNED",
      pendingConfirmation: {
        action: "activate_trip",
        summary: "Start the 3-day Jaipur trip.",
        requestedAt: "2026-10-06T00:02:00.000Z",
      },
    };
    expect(conversationSessionSchema.safeParse(session).success).toBe(true);
  });

  it("rejects malformed sessions", () => {
    expect(conversationSessionSchema.safeParse({}).success).toBe(false);
    expect(
      conversationSessionSchema.safeParse({
        sessionVersion: 1,
        transcript: [{ role: "human", text: "hi", createdAt: "x" }],
        tripStatus: "DRAFT",
      }).success,
    ).toBe(false);
    expect(
      conversationSessionSchema.safeParse({
        sessionVersion: 2,
        transcript: [],
        tripStatus: "DRAFT",
      }).success,
    ).toBe(false);
    expect(
      conversationSessionSchema.safeParse({
        sessionVersion: 1,
        transcript: [],
        tripStatus: "BOOKED",
      }).success,
    ).toBe(false);
  });

  it("rejects oversized transcripts and messages instead of truncating", () => {
    const full = {
      sessionVersion: 1 as const,
      transcript: Array.from({ length: MAX_TRANSCRIPT_ENTRIES }, (_, i) => ({
        role: "user" as const,
        text: `message ${i}`,
        createdAt: "2026-10-06T00:00:00.000Z",
      })),
      tripStatus: "DRAFT" as const,
    };
    expect(() =>
      appendTranscriptEntry(full, { role: "user", text: "one more" }),
    ).toThrow(ValidationError);
    expect(() =>
      appendTranscriptEntry(createEmptySession(), {
        role: "user",
        text: "x".repeat(MAX_TRANSCRIPT_TEXT_LENGTH + 1),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      appendTranscriptEntry(createEmptySession(), { role: "user", text: "   " }),
    ).toThrow(ValidationError);
  });

  it("appends entries with typed action metadata", () => {
    const next = appendTranscriptEntry(
      createEmptySession(),
      {
        role: "assistant",
        text: "Found options.",
        action: { capability: "booking_discover", status: "completed", ref: "3 options" },
        now: new Date("2026-10-06T00:00:00.000Z"),
      },
    );
    expect(next.transcript).toHaveLength(1);
    expect(next.transcript[0]?.action?.capability).toBe("booking_discover");
    expect(next.transcript[0]?.createdAt).toBe("2026-10-06T00:00:00.000Z");
  });

  it("rejects invalid selections, discovery, plan, and check payloads", () => {
    const base = { sessionVersion: 1, transcript: [], tripStatus: "DRAFT" };
    expect(
      conversationSessionSchema.safeParse({
        ...base,
        selections: Array.from({ length: 11 }, () => ({ optionId: "x" })),
      }).success,
    ).toBe(false);
    expect(
      conversationSessionSchema.safeParse({
        ...base,
        activePlan: { destination: "Jaipur" },
      }).success,
    ).toBe(false);
    expect(
      conversationSessionSchema.safeParse({
        ...base,
        latestCheck: { summary: {} },
      }).success,
    ).toBe(false);
  });

  it("serializes safely with no secret fields", () => {
    const withJunk = {
      sessionVersion: 1,
      transcript: [],
      tripStatus: "DRAFT",
      apiKey: "sk-should-never-persist",
      SERPAPI_KEY: "also-never",
    };
    const parsed = conversationSessionSchema.safeParse(withJunk);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const serialized = JSON.stringify(parsed.data);
      expect(serialized).not.toContain("sk-should-never-persist");
      expect(serialized).not.toContain("SERPAPI_KEY");
      expect("apiKey" in parsed.data).toBe(false);
    }
  });
});
