/**
 * Unit tests for RealityCheck report helpers (Phase 5 Step 2).
 * Pure function tests — no DOM, no network. Component rendering is
 * verified live in the browser; these tests pin semantics and parsing.
 */
import { describe, expect, it } from "vitest";
import {
  deriveOverallStatus,
  formatCheckedAt,
  parseRealityCheckResponse,
  STATUS_COPY,
} from "../app/components/RealityCheckReport";

function report(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      checkedAt: "2026-10-05T09:46:09.235Z",
      summary: { verified: 13, needsAttention: 0, problem: 0, unverified: 4 },
      items: [
        {
          itemId: "d1-attraction-1",
          kind: "attraction",
          title: "Synthetic Fort",
          status: "VERIFIED",
          facts: [],
          reasons: ["Re-identified by stable place identifier."],
        },
      ],
      warnings: [],
      ...extra,
    },
  };
}

describe("deriveOverallStatus", () => {
  it("reports PROBLEM when any problem exists", () => {
    expect(
      deriveOverallStatus({ verified: 10, needsAttention: 2, problem: 1, unverified: 3 }),
    ).toBe("PROBLEM");
  });

  it("reports NEEDS_ATTENTION when attention exists without problems", () => {
    expect(
      deriveOverallStatus({ verified: 10, needsAttention: 1, problem: 0, unverified: 0 }),
    ).toBe("NEEDS_ATTENTION");
  });

  it("reports VERIFIED when only verified and unverified items exist", () => {
    expect(
      deriveOverallStatus({ verified: 5, needsAttention: 0, problem: 0, unverified: 4 }),
    ).toBe("VERIFIED");
  });

  it("reports UNVERIFIED when nothing was verified", () => {
    expect(
      deriveOverallStatus({ verified: 0, needsAttention: 0, problem: 0, unverified: 4 }),
    ).toBe("UNVERIFIED");
  });

  it("reports UNVERIFIED for an empty report", () => {
    expect(
      deriveOverallStatus({ verified: 0, needsAttention: 0, problem: 0, unverified: 0 }),
    ).toBe("UNVERIFIED");
  });
});

describe("status copy", () => {
  it("never describes UNVERIFIED as a contradiction", () => {
    expect(STATUS_COPY.UNVERIFIED).toContain("could not be verified");
    expect(STATUS_COPY.UNVERIFIED).not.toMatch(/contradict|problem|invalid/i);
  });
});

describe("formatCheckedAt", () => {
  it("formats a valid timestamp", () => {
    expect(formatCheckedAt("2026-10-05T09:46:09.235Z")).not.toBeNull();
  });

  it("returns null for invalid timestamps", () => {
    expect(formatCheckedAt("not-a-date")).toBeNull();
    expect(formatCheckedAt("")).toBeNull();
  });
});

describe("parseRealityCheckResponse", () => {
  it("accepts a well-formed report", () => {
    const parsed = parseRealityCheckResponse(report());
    expect(parsed?.summary.verified).toBe(13);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.status).toBe("VERIFIED");
  });

  it("rejects failure payloads", () => {
    expect(
      parseRealityCheckResponse({ ok: false, error: { message: "x" } }),
    ).toBeNull();
  });

  it("rejects missing summary counts", () => {
    expect(
      parseRealityCheckResponse({ ok: true, data: { items: [] } }),
    ).toBeNull();
  });

  it("rejects non-array items", () => {
    const bad = report({ items: "nope" });
    expect(parseRealityCheckResponse(bad)).toBeNull();
  });

  it("drops malformed items but keeps valid ones", () => {
    const mixed = report({
      items: [
        {
          itemId: "ok-1",
          kind: "attraction",
          title: "Good",
          status: "VERIFIED",
          facts: [],
          reasons: [],
        },
        { nope: true },
        "junk",
      ],
    });
    const parsed = parseRealityCheckResponse(mixed);
    expect(parsed?.items).toHaveLength(1);
  });

  it("defaults missing facts/reasons to empty arrays", () => {
    const sparse = report({
      items: [
        { itemId: "s-1", kind: "note", title: "Evening", status: "UNVERIFIED" },
      ],
    });
    const parsed = parseRealityCheckResponse(sparse);
    expect(parsed?.items[0]?.facts).toEqual([]);
    expect(parsed?.items[0]?.reasons).toEqual([]);
  });

  it("rejects non-object payloads", () => {
    expect(parseRealityCheckResponse(null)).toBeNull();
    expect(parseRealityCheckResponse("oops")).toBeNull();
    expect(parseRealityCheckResponse([])).toBeNull();
  });
});
