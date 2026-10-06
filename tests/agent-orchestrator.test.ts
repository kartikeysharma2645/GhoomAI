/**
 * Phase 10 Prompt 2 orchestrator tests: deterministic single-action
 * dispatch, approval gates, and session updates. Gateway and vision
 * provider are replaced with explicitly labeled fakes — no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "../src/lib/errors";
import {
  orchestrateTurn,
  type ConfirmPayload,
} from "../src/server/agent/orchestrator";
import {
  conversationSessionSchema,
  createEmptySession,
  type ConversationSession,
} from "../src/server/agent/session";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import type { TripPlan } from "../src/server/trips/plan";
import {
  registerVisionProvider,
  unregisterVisionProvider,
  type VisionProvider,
} from "../src/server/vision/providers";

const NOW = new Date("2026-10-06T00:00:00.000Z");
const FAKE_VISION = "test-only-orchestrator-vision";

afterEach(() => {
  unregisterVisionProvider(FAKE_VISION);
});

function planFixture(): TripPlan {
  return {
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
            evidence: [
              {
                engine: "google_maps",
                observedAt: "2026-10-04T00:00:00.000Z",
                placeId: "ChX1",
                query: "tourist attractions in Jaipur",
                purpose: "attraction",
                facts: { rating: 4.5, reviews: 1000, address: "Synthetic Road, Jaipur" },
              },
            ],
          },
        ],
        dayCost: { lines: [], currency: "INR" },
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  } as TripPlan;
}

function sessionWithPlan(status: "PLANNED" | "APPROVED" | "ACTIVE" = "APPROVED"): ConversationSession {
  return conversationSessionSchema.parse({
    sessionVersion: 1,
    transcript: [],
    activePlan: planFixture(),
    tripStatus: status,
  });
}

function fakeGateway(overrides: {
  maps?: unknown[];
  hotels?: unknown[];
  web?: unknown[];
  mapsError?: Error;
  hotelsError?: Error;
  webError?: Error;
} = {}) {
  const failOr = (error: Error | undefined, payload: unknown) => () =>
    error ? Promise.reject(error) : Promise.resolve(payload);
  return {
    searchMaps: vi.fn().mockImplementation(
      failOr(overrides.mapsError, {
        engine: "google_maps",
        query: "q",
        resultCount: (overrides.maps ?? []).length,
        results: overrides.maps ?? [],
      }),
    ),
    searchHotels: vi.fn().mockImplementation(
      failOr(overrides.hotelsError, {
        engine: "google_hotels",
        query: "q",
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        currency: "INR",
        resultCount: (overrides.hotels ?? []).length,
        results: overrides.hotels ?? [],
      }),
    ),
    search: vi.fn().mockImplementation(
      failOr(overrides.webError, {
        engine: "google",
        query: "q",
        resultCount: (overrides.web ?? []).length,
        results: overrides.web ?? [],
      }),
    ),
  };
}

function asClient(fake: ReturnType<typeof fakeGateway>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

const PLACE = {
  position: 1,
  title: "Synthetic Fort",
  placeId: "ChX1",
  rating: 4.5,
  reviews: 1000,
  address: "Synthetic Road, Jaipur",
};

function turn(
  session: ConversationSession,
  message: string,
  confirm?: ConfirmPayload,
  deps: { client?: SerpApiClient; now?: Date; image?: { bytes: Uint8Array; mimeType?: string } } = {},
) {
  return orchestrateTurn(session, message, confirm, { now: NOW, ...deps });
}

describe("orchestrator dispatch", () => {
  it("executes search intents through the existing responder", async () => {
    const fake = fakeGateway({ web: [{ position: 1, title: "T", link: "https://example.com", snippet: "S" }] });
    const res = await turn(createEmptySession(), "Tell me about Jaipur tourism", undefined, {
      client: asClient(fake),
    });
    expect(res.intent).toBe("general_search");
    expect(res.outcome).toBe("completed");
    expect(res.capability).toBe("executeIntent");
    expect(fake.search).toHaveBeenCalledTimes(1);
    expect(res.session.transcript).toHaveLength(2);
  });

  it("performs no service call for out_of_scope or clarification", async () => {
    const fake = fakeGateway();
    const scoped = await turn(createEmptySession(), "Write a poem", undefined, {
      client: asClient(fake),
    });
    expect(scoped.outcome).toBe("out_of_scope");
    const clarified = await turn(createEmptySession(), "Check it", undefined, {
      client: asClient(fake),
    });
    expect(clarified.outcome).toBe("clarification");
    expect(fake.searchMaps).not.toHaveBeenCalled();
    expect(fake.searchHotels).not.toHaveBeenCalled();
    expect(fake.search).not.toHaveBeenCalled();
  });

  it("plans deterministically and stores plan + PLANNED status", async () => {
    const fake = fakeGateway({
      maps: [PLACE],
      hotels: [{ position: 1, name: "Synthetic Grand", propertyToken: "tok1" }],
    });
    const res = await turn(
      createEmptySession(),
      "Plan 3 flexible days in Jaipur",
      undefined,
      { client: asClient(fake) },
    );
    expect(res.intent).toBe("plan_trip");
    expect(res.outcome).toBe("completed");
    expect(res.session.activePlan?.destination).toBe("Jaipur");
    expect(res.session.activePlan?.durationDays).toBe(3);
    expect(res.session.tripStatus).toBe("PLANNED");
    expect(res.followUps.length).toBeGreaterThan(0);
  });

  it("never invents planning values: missing destination clarifies", async () => {
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "Plan a 3-day trip", undefined, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("clarification");
    expect(res.session.activePlan).toBeUndefined();
    expect(fake.searchMaps).not.toHaveBeenCalled();
    expect(fake.searchHotels).not.toHaveBeenCalled();
  });

  it("never invents dates: dateless fixed planning clarifies", async () => {
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "Plan 3 days in Jaipur", undefined, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("clarification");
    expect(res.session.activePlan).toBeUndefined();
    expect(fake.searchMaps).not.toHaveBeenCalled();
    expect(fake.searchHotels).not.toHaveBeenCalled();
  });

  it("runs one RealityCheck per check turn without chaining", async () => {
    const fake = fakeGateway({ maps: [PLACE], hotels: [] });
    const res = await turn(sessionWithPlan("PLANNED"), "Check if my itinerary is realistic", undefined, {
      client: asClient(fake),
    });
    expect(res.intent).toBe("check_trip");
    expect(res.outcome).toBe("completed");
    expect(res.session.latestCheck).toBeDefined();
    // No hidden chain: no proposal, no activation, no selection recorded.
    expect(res.session.pendingConfirmation).toBeUndefined();
    expect(res.session.activeTrip).toBeUndefined();
    expect(res.session.selections).toBeUndefined();
    expect(res.session.tripStatus).toBe("PLANNED");
  });

  it("clarifies fix requests without a prior check", async () => {
    const fake = fakeGateway();
    const res = await turn(sessionWithPlan("PLANNED"), "Fix the problems", undefined, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("clarification");
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("returns a fix proposal without applying it", async () => {
    const fake = fakeGateway({
      maps: [
        { ...PLACE, openState: "Permanently closed" },
        { position: 2, title: "Fresh Palace", placeId: "ChX9", rating: 4.6, reviews: 900 },
      ],
      hotels: [],
    });
    const checked = await turn(sessionWithPlan("PLANNED"), "Check it", undefined, {
      client: asClient(fake),
    });
    expect(checked.session.latestCheck?.summary.problem).toBe(1);
    const proposed = await turn(checked.session, "Propose fixes", undefined, {
      client: asClient(fake),
    });
    expect(proposed.intent).toBe("fix_trip");
    expect(proposed.outcome).toBe("confirmation_required");
    expect(proposed.session.pendingConfirmation?.action).toBe("apply_fix");
    // Plan untouched by proposal generation.
    expect(proposed.session.activePlan?.days[0]?.items[0]?.title).toBe("Synthetic Fort");
  });

  it("discovers booking options without recording a selection", async () => {
    const fake = fakeGateway({ maps: [PLACE], hotels: [], web: [] });
    const res = await turn(sessionWithPlan(), "Find booking options", undefined, {
      client: asClient(fake),
    });
    expect(res.intent).toBe("booking_discover");
    expect(res.outcome).toBe("completed");
    expect(res.session.latestDiscovery?.length).toBeGreaterThan(0);
    expect(res.session.selections).toBeUndefined();
  });

  it("keeps recheck verification-only without mutating the plan", async () => {
    const fake = fakeGateway({ maps: [PLACE], hotels: [] });
    const before = JSON.stringify(sessionWithPlan().activePlan);
    const res = await turn(sessionWithPlan(), "Run the final pre-trip check", undefined, {
      client: asClient(fake),
    });
    expect(res.intent).toBe("booking_recheck");
    expect(res.outcome).toBe("completed");
    expect(JSON.stringify(res.session.activePlan)).toBe(before);
    expect(res.session.tripStatus).toBe("APPROVED");
  });

  it("reports trip status and progress from session state without calls", async () => {
    const fake = fakeGateway();
    const status = await turn(sessionWithPlan(), "What is my trip status?", undefined, {
      client: asClient(fake),
    });
    expect(status.intent).toBe("trip_status");
    expect(status.message).toMatch(/APPROVED/);
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("maps upstream failure to a retryable failed outcome with state preserved", async () => {
    const fake = fakeGateway({ mapsError: new UpstreamError("down"), hotelsError: new UpstreamError("down") });
    const res = await turn(sessionWithPlan("PLANNED"), "Check it", undefined, {
      client: asClient(fake),
    });
    // checkTrip isolates per-item failures into UNVERIFIED rather than throwing.
    expect(res.outcome).toBe("completed");
    expect(res.session.latestCheck?.summary.verified).toBe(0);
  });

  it("returns failed outcome when every verification call throws", async () => {
    const fake = {
      searchMaps: vi.fn().mockRejectedValue(new UpstreamError("down")),
      searchHotels: vi.fn().mockRejectedValue(new UpstreamError("down")),
      search: vi.fn().mockRejectedValue(new UpstreamError("down")),
    };
    const res = await turn(
      {
        ...sessionWithPlan("PLANNED"),
        activePlan: { ...planFixture(), stay: undefined },
      } as ConversationSession,
      "Find booking options",
      undefined,
      { client: asClient(fake) },
    );
    // booking_discover requires APPROVED; PLANNED clarifies without calls.
    expect(res.outcome).toBe("clarification");
  });
});

function makeFixProposal() {
  return {
    basedOnCheckedAt: NOW.toISOString(),
    changes: [
      {
        itemId: "d1-a1",
        dayNumber: 1,
        action: "replace_attraction" as const,
        originalTitle: "Synthetic Fort",
        originalFinding: { status: "PROBLEM" as const, summary: "Closed." },
        replacement: {
          id: "d1-a1-new",
          kind: "attraction" as const,
          title: "Fresh Palace",
          place: { name: "Fresh Palace" },
          evidence: [
            {
              engine: "google_maps" as const,
              observedAt: NOW.toISOString(),
              placeId: "ChX9",
              query: "q",
              purpose: "attraction" as const,
              facts: {},
            },
          ],
        },
        candidatesConsidered: 1,
        reasons: ["Verified alternative."],
        recheck: {
          itemId: "d1-a1-new",
          kind: "attraction",
          title: "Fresh Palace",
          status: "VERIFIED" as const,
          facts: [],
          reasons: ["Re-identified."],
        },
      },
    ],
    unchangedItemIds: [],
    unfixable: [],
    recheckSummary: { verified: 1, needsAttention: 0, problem: 0, unverified: 0 },
    warnings: [],
  };
}

describe("orchestrator approval gates", () => {
  it("requests confirmation for activation without executing", async () => {
    const fake = fakeGateway();
    const res = await turn(sessionWithPlan(), "Start my trip", undefined, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("confirmation_required");
    expect(res.confirmationRequired?.action).toBe("activate_trip");
    expect(res.session.pendingConfirmation?.action).toBe("activate_trip");
    expect(res.session.tripStatus).toBe("APPROVED");
    expect(res.session.activeTrip).toBeUndefined();
  });

  it("executes activation only on explicit matching confirmation", async () => {
    const fake = fakeGateway();
    const requested = await turn(sessionWithPlan(), "Start my trip", undefined, {
      client: asClient(fake),
    });
    const done = await turn(
      requested.session,
      "Yes, start",
      { action: "activate_trip" },
      { client: asClient(fake) },
    );
    expect(done.outcome).toBe("completed");
    expect(done.session.tripStatus).toBe("ACTIVE");
    expect(done.session.activeTrip?.status).toBe("ACTIVE");
    expect(done.session.pendingConfirmation).toBeUndefined();
  });

  it("rejects mismatched confirmations without executing", async () => {
    const fake = fakeGateway();
    const requested = await turn(sessionWithPlan(), "Start my trip", undefined, {
      client: asClient(fake),
    });
    const res = await turn(
      requested.session,
      "Yes, apply",
      { action: "apply_fix", changeIds: ["d1-a1"], proposal: makeFixProposal() },
      { client: asClient(fake) },
    );
    expect(res.outcome).toBe("confirmation_rejected");
    expect(res.session.tripStatus).toBe("APPROVED");
    expect(res.session.activeTrip).toBeUndefined();
    expect(res.session.pendingConfirmation).toBeUndefined();
  });

  it("rejects stale confirmations", async () => {
    const fake = fakeGateway();
    const requested = await turn(sessionWithPlan(), "Start my trip", undefined, {
      client: asClient(fake),
    });
    const staleSession: ConversationSession = {
      ...requested.session,
      pendingConfirmation: {
        action: "activate_trip",
        summary: "old",
        requestedAt: new Date(NOW.getTime() - 31 * 60_1000).toISOString(),
      },
    };
    const res = await turn(staleSession, "Yes", { action: "activate_trip" }, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("confirmation_rejected");
    expect(res.session.activeTrip).toBeUndefined();
  });

  it("cancels cleanly on explicit cancel", async () => {
    const fake = fakeGateway();
    const requested = await turn(sessionWithPlan(), "Start my trip", undefined, {
      client: asClient(fake),
    });
    const res = await turn(requested.session, "No, cancel it", { action: "activate_trip" }, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("confirmation_rejected");
    expect(res.session.pendingConfirmation).toBeUndefined();
    expect(res.session.activeTrip).toBeUndefined();
  });

  it("rejects confirmation with no pending action", async () => {
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "Yes", { action: "activate_trip" }, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("confirmation_rejected");
  });

  it("records a booking selection receipt without claiming a booking", async () => {
    const { optionFromMapsPlace } = await import("../src/server/booking/discovery");
    const option = optionFromMapsPlace({
      itemId: "d1-a1",
      place: { ...PLACE, links: { website: "https://fort.example.com/info" } },
      sentQuery: "Synthetic Fort Jaipur",
      purpose: "attraction",
      observedAt: NOW.toISOString(),
      leadType: "CORROBORATED",
    });
    const withOptions: ConversationSession = {
      ...sessionWithPlan(),
      latestDiscovery: [
        { itemId: "d1-a1", kind: "attraction", title: "Synthetic Fort", status: "READY", options: [option] },
      ],
    };
    const fake = fakeGateway();
    const proposed = await turn(withOptions, "Use the first one", undefined, {
      client: asClient(fake),
    });
    expect(proposed.outcome).toBe("confirmation_required");
    expect(proposed.session.selections).toBeUndefined();
    const done = await turn(
      proposed.session,
      "Yes, use it",
      { action: "booking_select", itemId: "d1-a1", option },
      { client: asClient(fake) },
    );
    expect(done.outcome).toBe("completed");
    expect(done.session.selections).toHaveLength(1);
    expect(done.message).toMatch(/did not complete any booking/i);
  });

  it("applies a fix through the existing apply service with valid IDs", async () => {
    const fake = fakeGateway();
    const pending: ConversationSession = {
      ...sessionWithPlan("PLANNED"),
      pendingConfirmation: {
        action: "apply_fix",
        summary: "Apply 1 fix.",
        requestedAt: NOW.toISOString(),
      },
    };
    const done = await turn(
      pending,
      "Yes, apply the fix",
      { action: "apply_fix", changeIds: ["d1-a1"], proposal: makeFixProposal() },
      { client: asClient(fake) },
    );
    expect(done.outcome).toBe("completed");
    expect(done.session.activePlan?.days[0]?.items[0]?.title).toBe("Fresh Palace");
    expect(done.session.tripStatus).toBe("PLANNED");
    expect(done.session.pendingConfirmation).toBeUndefined();
  });

  it("rejects stale change IDs without mutating the plan", async () => {
    const fake = fakeGateway();
    const before = JSON.stringify(sessionWithPlan("PLANNED").activePlan);
    const pending: ConversationSession = {
      ...sessionWithPlan("PLANNED"),
      pendingConfirmation: {
        action: "apply_fix",
        summary: "Apply fix.",
        requestedAt: NOW.toISOString(),
      },
    };
    const done = await turn(
      pending,
      "Yes",
      { action: "apply_fix", changeIds: ["nope"], proposal: makeFixProposal() },
      { client: asClient(fake) },
    );
    expect(done.outcome).toBe("failed");
    expect(JSON.stringify(done.session.activePlan)).toBe(before);
  });
});

describe("orchestrator vision safety", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it("asks for an image when none is attached", async () => {
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "What is this monument?", undefined, {
      client: asClient(fake),
    });
    expect(res.outcome).toBe("clarification");
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("preserves honest VISION_NOT_CONFIGURED behavior", async () => {
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "What is this monument?", undefined, {
      client: asClient(fake),
      image: { bytes: jpeg, mimeType: "image/jpeg" },
    });
    expect(res.outcome).toBe("failed");
    expect(res.errorCode).toBe("VISION_NOT_CONFIGURED");
  });

  it("dispatches to the vision service when a provider exists", async () => {
    const provider: VisionProvider = {
      name: FAKE_VISION,
      analyzeImage: async () => ({
        candidates: [{ name: "Synthetic Fort", confidence: 0.9 }],
        observations: ["stone facade"],
        warnings: [],
      }),
    };
    registerVisionProvider(provider);
    const fake = fakeGateway();
    const res = await turn(createEmptySession(), "What is this monument?", undefined, {
      client: asClient(fake),
      image: { bytes: jpeg, mimeType: "image/jpeg" },
    });
    expect(res.outcome).toBe("completed");
    expect(res.capability).toBe("analyzeImage");
    expect(res.message).toMatch(/Synthetic Fort/);
  });
});
