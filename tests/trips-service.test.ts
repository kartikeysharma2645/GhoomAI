/**
 * Unit tests for the trip service orchestrator.
 * The SerpApiClient is replaced with an explicitly labeled fake returning
 * minimal EMPTY normalized shapes — no real travel data is fabricated.
 */
import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "../src/lib/errors";
import type { SerpApiClient } from "../src/server/services/serpapi/client";
import { planTrip } from "../src/server/trips/service";

const NOW = new Date("2026-10-04T00:00:00.000Z");

function request() {
  return {
    destination: "Jaipur",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    adults: 2,
    interests: ["history"],
  };
}

function fakeClient() {
  return {
    searchHotels: vi.fn().mockResolvedValue({
      engine: "google_hotels",
      query: "q",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      currency: "INR",
      resultCount: 0,
      results: [],
    }),
    searchMaps: vi.fn().mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: 0,
      results: [],
    }),
    search: vi.fn(),
  };
}

function asClient(fake: ReturnType<typeof fakeClient>): SerpApiClient {
  return fake as unknown as SerpApiClient;
}

describe("trip service", () => {
  it("plans successfully with live research", async () => {
    const fake = fakeClient();
    const result = await planTrip(request(), asClient(fake), NOW);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.destination).toBe("Jaipur");
    expect(result.plan.days).toHaveLength(3);
    expect(result.plan.warnings.length).toBeGreaterThan(0);
  });

  it("returns needs_input when destination is missing", async () => {
    const fake = fakeClient();
    const result = await planTrip(
      { startDate: "2026-11-10", endDate: "2026-11-12" },
      asClient(fake),
      NOW,
    );
    expect(result.status).toBe("needs_input");
    if (result.status !== "needs_input") return;
    expect(result.missing).toContain("destination");
    expect(fake.searchHotels).not.toHaveBeenCalled();
    expect(fake.searchMaps).not.toHaveBeenCalled();
  });

  it("passes trip dates and party to hotel research", async () => {
    const fake = fakeClient();
    await planTrip(request(), asClient(fake), NOW);
    expect(fake.searchHotels).toHaveBeenCalledTimes(1);
    const arg = fake.searchHotels.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.checkIn).toBe("2026-11-10");
    expect(arg.checkOut).toBe("2026-11-12");
    expect(arg.adults).toBe(2);
  });

  it("queries restaurants only when food is requested", async () => {
    const withoutFood = fakeClient();
    await planTrip(
      { ...request(), interests: ["history"] },
      asClient(withoutFood),
      NOW,
    );
    const historyQueries = withoutFood.searchMaps.mock.calls.map(
      (c) => (c[0] as { query: string }).query,
    );
    expect(historyQueries.some((q) => q.includes("restaurants"))).toBe(false);
    expect(historyQueries).toContain("tourist attractions in Jaipur");

    const withFood = fakeClient();
    await planTrip(
      { ...request(), interests: ["food"] },
      asClient(withFood),
      NOW,
    );
    expect(withFood.searchMaps).toHaveBeenCalledTimes(2);
    const second = withFood.searchMaps.mock.calls[1][0] as Record<
      string,
      unknown
    >;
    expect(String(second.query)).toContain("restaurants");
  });

  it("returns a partial plan without fabricated stays on hotel failure", async () => {
    const fake = fakeClient();
    fake.searchHotels.mockRejectedValue(new UpstreamError("boom"));
    const result = await planTrip(request(), asClient(fake), NOW);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.stay).toBeUndefined();
    expect(
      result.plan.warnings.some((w) => w.includes("Accommodation research failed")),
    ).toBe(true);
  });

  it("throws when all research fails", async () => {
    const fake = fakeClient();
    fake.searchHotels.mockRejectedValue(new UpstreamError("down"));
    fake.searchMaps.mockRejectedValue(new UpstreamError("down"));
    await expect(planTrip(request(), asClient(fake), NOW)).rejects.toThrow(
      UpstreamError,
    );
  });
});

describe("trip service destination context (Step 2)", () => {
  function richMaps() {
    return Array.from({ length: 5 }, (_, i) => ({
      position: i + 1,
      title: `Synthetic Place ${i + 1}`,
      rating: 4.5,
    }));
  }

  it("threads destination context when the pool is thin", async () => {
    const fake = fakeClient();
    fake.search.mockResolvedValue({
      engine: "google",
      query: "Jaipur travel guide",
      resultCount: 1,
      results: [
        {
          position: 1,
          title: "Synthetic Guide",
          link: "https://example.invalid/guide",
          snippet: "A synthetic destination summary.",
        },
      ],
    });
    const result = await planTrip(request(), asClient(fake), NOW);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(fake.search).toHaveBeenCalledTimes(1);
    expect(result.plan.destinationContext?.summary).toEqual([
      "A synthetic destination summary.",
    ]);
    expect(result.plan.destinationContext?.sources).toEqual([
      { title: "Synthetic Guide", link: "https://example.invalid/guide" },
    ]);
  });

  it("skips destination search when the pool is rich", async () => {
    const fake = fakeClient();
    fake.searchMaps.mockResolvedValue({
      engine: "google_maps",
      query: "q",
      resultCount: 5,
      results: richMaps(),
    });
    const result = await planTrip(
      { ...request(), interests: ["history"] },
      asClient(fake),
      NOW,
    );
    expect(result.status).toBe("ready");
    expect(fake.search).not.toHaveBeenCalled();
    if (result.status !== "ready") return;
    expect(result.plan.destinationContext).toBeUndefined();
  });

  it("degrades gracefully when destination search fails", async () => {
    const fake = fakeClient();
    fake.search.mockRejectedValue(new UpstreamError("down"));
    const result = await planTrip(request(), asClient(fake), NOW);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.destinationContext).toBeUndefined();
    expect(
      result.plan.warnings.some((w) =>
        w.includes("Destination background research failed"),
      ),
    ).toBe(true);
  });
});
