/**
 * Visual-discovery routing contract (UI Phase 2).
 *
 * Pure routing tests — no network, no execution. Each discovery category
 * prompt must deterministically reach `discover_places` (Google Maps live
 * search) from a FRESH session, so clicking an inspiration image always
 * produces real results through the existing agent infrastructure.
 * If a prompt ever misroutes (plan/fix/check/booking/out_of_scope…),
 * this suite fails before any UI ships it.
 */
import { describe, expect, it } from "vitest";
import { resolveAgentIntent } from "../src/server/agent/router";
import {
  DISCOVERY_CATEGORIES,
  discoveryCategory,
} from "../app/components/travel-images";

describe("visual discovery prompts route to live place search", () => {
  it("covers exactly the eight shipped categories", () => {
    expect(DISCOVERY_CATEGORIES.map((c) => c.key)).toEqual([
      "mountains",
      "beaches",
      "lakes",
      "forests",
      "villages",
      "heritage",
      "luxury",
      "roads",
    ]);
  });

  it.each(DISCOVERY_CATEGORIES.map((c) => [c.key, c.prompt]))(
    "prompt for '%s' resolves to discover_places on a fresh session",
    (_key, prompt) => {
      const intent = resolveAgentIntent(prompt, {});
      expect(intent.intent).toBe("discover_places");
      expect(intent.engine).toBe("google_maps");
      expect(intent.missing).toEqual([]);
    },
  );

  it("prompts fit the agent message limits", () => {
    for (const c of DISCOVERY_CATEGORIES) {
      expect(c.prompt.length).toBeGreaterThan(0);
      expect(c.prompt.length).toBeLessThanOrEqual(500);
    }
  });

  it("prompts carry no capability triggers that could misroute", () => {
    const forbidden = [
      "plan",
      "check",
      "re-check",
      "recheck",
      "verify",
      "fix",
      "replace",
      "book",
      "reserve",
      "reschedul",
      "delay",
      "activate",
      "start the trip",
      "what's next",
      "hotel",
      "stay",
      "resort",
      "villa",
      "hostel",
      "room",
      "accommodation",
      "guesthouse",
      "check-in",
    ];
    for (const c of DISCOVERY_CATEGORIES) {
      const lower = c.prompt.toLowerCase();
      for (const word of forbidden) {
        expect(lower).not.toContain(word);
      }
    }
  });
});

describe("discoveryCategory lookup", () => {
  it("resolves every shipped key with its prompt and heading", () => {
    for (const c of DISCOVERY_CATEGORIES) {
      const found = discoveryCategory(c.key);
      expect(found?.prompt).toBe(c.prompt);
      expect(found?.heading).toBeTruthy();
    }
  });

  it("returns null for unknown, empty, or missing keys", () => {
    expect(discoveryCategory("atlantis")).toBeNull();
    expect(discoveryCategory("")).toBeNull();
    expect(discoveryCategory(null)).toBeNull();
    expect(discoveryCategory(undefined)).toBeNull();
  });
});
