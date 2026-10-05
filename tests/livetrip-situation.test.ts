/**
 * Unit tests for live situation contracts and candidate selection.
 * Pure function tests — no network, no live data.
 */
import { describe, expect, it } from "vitest";
import {
  fallbackPlaceQuery,
  renderDestinationQuery,
  selectLiveCheckCandidates,
  situationId,
  MAX_LIVE_ITEMS,
} from "../src/server/livetrip/situation";

function item(
  id: string,
  kind: string,
  title: string,
  status: string,
  dayNumber: number,
  query?: string,
) {
  return {
    id,
    kind,
    title,
    place: { name: title },
    evidence: query !== undefined ? [{ query }] : [],
  };
}

function progressEntry(dayNumber: number, itemId: string, status: string) {
  return { dayNumber, itemId, status };
}

describe("query builders", () => {
  it("builds deterministic fallbacks", () => {
    expect(fallbackPlaceQuery("Amber Palace", "Jaipur")).toBe(
      "Amber Palace Jaipur",
    );
  });

  it("renders destination templates", () => {
    expect(
      renderDestinationQuery("{destination} travel disruption", "Jaipur"),
    ).toBe("Jaipur travel disruption");
  });

  it("derives stable situation IDs", () => {
    expect(situationId("CLOSED", "ChX1", "q")).toBe(
      situationId("CLOSED", "ChX1", "q"),
    );
    expect(situationId("CLOSED", "ChX1", "q")).not.toBe(
      situationId("CLOSED", "ChX2", "q"),
    );
  });
});

describe("selectLiveCheckCandidates", () => {
  function trip(
    days: Array<{ dayNumber: number; items: ReturnType<typeof item>[] }>,
    progress: Array<{ dayNumber: number; items: ReturnType<typeof progressEntry>[] }>,
    currentDayNumber = 1,
  ) {
    return { destination: "Jaipur", currentDayNumber, days, progress };
  }

  it("skips COMPLETED, SKIPPED, and notes", () => {
    const candidates = selectLiveCheckCandidates(
      trip(
        [
          {
            dayNumber: 1,
            items: [
              item("a", "attraction", "A", "UPCOMING", 1, "q a"),
              item("b", "attraction", "B", "UPCOMING", 1, "q b"),
              item("c", "note", "C", "UPCOMING", 1, "q c"),
            ],
          },
        ],
        [
          {
            dayNumber: 1,
            items: [
              progressEntry(1, "a", "UPCOMING"),
              progressEntry(1, "b", "COMPLETED"),
              progressEntry(1, "c", "UPCOMING"),
            ],
          },
        ],
      ),
    );
    expect(candidates.map((c) => c.itemId)).toEqual(["a"]);
  });

  it("prioritizes the current day, then later days, skipping past days", () => {
    const candidates = selectLiveCheckCandidates(
      trip(
        [
          { dayNumber: 1, items: [item("past", "attraction", "Past", "UPCOMING", 1, "q")] },
          { dayNumber: 2, items: [item("now", "attraction", "Now", "UPCOMING", 2, "q")] },
          { dayNumber: 3, items: [item("later", "attraction", "Later", "UPCOMING", 3, "q")] },
        ],
        [
          { dayNumber: 1, items: [progressEntry(1, "past", "UPCOMING")] },
          { dayNumber: 2, items: [progressEntry(2, "now", "UPCOMING")] },
          { dayNumber: 3, items: [progressEntry(3, "later", "UPCOMING")] },
        ],
        2,
      ),
    );
    expect(candidates.map((c) => c.itemId)).toEqual(["now", "later"]);
  });

  it("caps the candidate count", () => {
    const items = Array.from({ length: MAX_LIVE_ITEMS + 4 }, (_, i) =>
      item(`a${i}`, "attraction", `Place ${i}`, "UPCOMING", 1, "q"),
    );
    const candidates = selectLiveCheckCandidates(
      trip(
        [{ dayNumber: 1, items }],
        [
          {
            dayNumber: 1,
            items: items.map((it) => progressEntry(1, it.id, "UPCOMING")),
          },
        ],
      ),
    );
    expect(candidates).toHaveLength(MAX_LIVE_ITEMS);
  });

  it("includes IN_PROGRESS items and falls back without stored queries", () => {
    const candidates = selectLiveCheckCandidates(
      trip(
        [{ dayNumber: 1, items: [item("a", "attraction", "Amber Palace", "UPCOMING", 1)] }],
        [{ dayNumber: 1, items: [progressEntry(1, "a", "IN_PROGRESS")] }],
      ),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.query).toBe("Amber Palace Jaipur");
  });
});
