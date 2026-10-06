import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentResultView from "../app/components/AgentResultView";
import ExternalLink from "../app/components/ExternalLink";
import ItineraryView from "../app/components/ItineraryView";
import ResultCards from "../app/components/ResultCards";

describe("ExternalLink contract", () => {
  it("renders a real anchor with href, target, rel, and label", () => {
    const html = renderToStaticMarkup(
      ExternalLink({ href: "https://example.com/fort", children: "View Place ↗" }) as any,
    );
    expect(html).toContain('href="https://example.com/fort"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("View Place ↗");
    expect(html.startsWith("<a ")).toBe(true);
  });

  it("rejects unsafe or missing URLs by rendering nothing", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "blob:https://x/y",
      "file:///etc/passwd",
      "/relative/path",
      "not a url",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(renderToStaticMarkup(ExternalLink({ href: bad, children: "X" }) as any)).toBe("");
    }
  });
});

describe("place result links", () => {
  const base = {
    intent: "discover_places",
    outcome: "completed",
    capability: "executeIntent",
    message: "m",
    followUps: [] as string[],
  };

  it("renders a View Place anchor with the real provider URL", () => {
    const html = renderToStaticMarkup(
      AgentResultView({
        turn: {
          ...base,
          data: {
            engine: "google_maps",
            resultCount: 1,
            results: [
              { title: "Hawa Mahal", links: { website: "https://example.com/hawa" } },
            ],
          },
        },
      }) as any,
    );
    expect(html).toContain('href="https://example.com/hawa"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("View Place ↗");
  });

  it("renders no anchor when the place has no provider URL", () => {
    const html = renderToStaticMarkup(
      AgentResultView({
        turn: {
          ...base,
          data: {
            engine: "google_maps",
            resultCount: 1,
            results: [{ title: "Hawa Mahal", rating: 4.5 }],
          },
        },
      }) as any,
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("Hawa Mahal");
  });

  it("renders hotel cards with no fabricated link", () => {
    const html = renderToStaticMarkup(
      AgentResultView({
        turn: {
          ...base,
          intent: "find_hotels",
          data: {
            engine: "google_hotels",
            resultCount: 1,
            results: [{ name: "Grand Hotel", overallRating: 4.6 }],
          },
        },
      }) as any,
    );
    expect(html).toContain("Grand Hotel");
    expect(html).not.toContain("<a ");
  });
});

describe("itinerary item links", () => {
  const plan = (evidence: unknown[]) => ({
    destination: "Jaipur",
    durationDays: 1,
    budgetVerdict: "within",
    party: { adults: 2, children: 0 },
    assumptions: [],
    warnings: [],
    days: [
      {
        dayNumber: 1,
        items: [{ id: "d1-a1", kind: "attraction", title: "Hawa Mahal", evidence }],
      },
    ],
    totals: { lines: [], currency: "INR" },
    pricesVerified: true,
  });

  it("renders View Place with the evidence source URL", () => {
    const html = renderToStaticMarkup(
      ItineraryView({ plan: plan([{ engine: "google_maps", sourceUrl: "https://example.com/hawa", facts: {} }]) } as any),
    );
    expect(html).toContain('href="https://example.com/hawa"');
    expect(html).toContain("View Place ↗");
  });

  it("renders no link when evidence has no URL", () => {
    const html = renderToStaticMarkup(
      ItineraryView({ plan: plan([{ engine: "google_maps", facts: {} }]) } as any),
    );
    expect(html).not.toContain("<a ");
  });
});

describe("booking option links in the agent", () => {
  const base = {
    intent: "booking_discover",
    outcome: "completed",
    capability: "discoverBookingOptions",
    message: "m",
    followUps: [] as string[],
  };
  const option = (url?: string) => ({
    optionId: "o1",
    title: "Fort tickets",
    provider: "tickets.example.com",
    ...(url ? { url } : {}),
  });

  it("renders Continue to provider as a real anchor", () => {
    const html = renderToStaticMarkup(
      AgentResultView({
        turn: {
          ...base,
          data: { discovery: { items: [{ itemId: "d1", title: "Fort", options: [option("https://tickets.example.com/fort")] }] } },
        },
      }) as any,
    );
    expect(html).toContain('href="https://tickets.example.com/fort"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Continue to provider ↗");
    expect(html).not.toContain("<button");
  });

  it("shows the search-lead state with no anchor when the option has no URL", () => {
    const html = renderToStaticMarkup(
      AgentResultView({
        turn: {
          ...base,
          data: { discovery: { items: [{ itemId: "d1", title: "Fort", options: [option()] }] } },
        },
      }) as any,
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("Search lead");
  });
});

describe("search result links", () => {
  it("links organic result titles to their real URLs", () => {
    const html = renderToStaticMarkup(
      ResultCards({
        data: {
          intent: "general_search",
          engine: "google",
          message: "m",
          resultCount: 1,
          results: [{ title: "Jaipur guide", link: "https://guide.example.com/jaipur", snippet: "s" }],
        },
      }) as any,
    );
    expect(html).toContain('href="https://guide.example.com/jaipur"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
