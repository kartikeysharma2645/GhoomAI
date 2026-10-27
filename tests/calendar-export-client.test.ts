/**
 * Unit tests for client-side calendar export (.ics generation).
 * Pure function tests — no network, no DOM. Verifies formatting, escaping,
 * date handling, and that untimed/invalid items are omitted.
 */

import { describe, expect, it } from "vitest";
import {
  buildIcsContentClient,
  icsFilenameClient,
} from "../app/components/calendarExportClient";

function makeDay(dayNumber: number, date: string | undefined, items: Array<{
  id: string;
  kind: string;
  title: string;
  startTime?: string;
  endTime?: string;
  place?: { name?: string; address?: string };
  notes?: string;
}>) {
  return { dayNumber, date, items };
}

describe("buildIcsContentClient", () => {
  it("produces a valid iCalendar skeleton", () => {
    const plan = {
      destination: "Jaipur",
      days: [makeDay(1, "2026-11-10", [])],
    };
    const content = buildIcsContentClient(plan);
    expect(content).toContain("BEGIN:VCALENDAR");
    expect(content).toContain("END:VCALENDAR");
    expect(content).toContain("VERSION:2.0");
    expect(content).toContain("PRODID:-//GhoomAI//Itinerary Export//EN");
    expect(content).toContain("CALSCALE:GREGORIAN");
    expect(content).toContain("METHOD:PUBLISH");
    expect(content).toContain("X-WR-CALNAME:");
  });

  it("includes timed attractions as VEVENT entries", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", [
          {
            id: "a1",
            kind: "attraction",
            title: "Amber Fort",
            startTime: "09:30",
            endTime: "12:00",
            place: { name: "Amber Fort", address: "Jaipur, Rajasthan" },
          },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    expect(content).toContain("BEGIN:VEVENT");
    expect(content).toContain("SUMMARY:Amber Fort");
    expect(content).toContain("DTSTART:20261110T093000Z");
    expect(content).toContain("DTEND:20261110T120000Z");
  });

  it("includes timed meals as VEVENT entries", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", [
          {
            id: "m1",
            kind: "meal",
            title: "Lunch near Laxmi Mishthan Bhandar",
            startTime: "12:00",
            endTime: "14:00",
            place: { name: "Laxmi Mishthan Bhandar", address: "Jaipur" },
          },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    expect(content).toContain("SUMMARY:Lunch near Laxmi Mishthan Bhandar");
    expect(content).toContain("DTSTART:20261110T120000Z");
    expect(content).toContain("DTEND:20261110T140000Z");
  });

  it("omits untimed notes without fabricating times", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", [
          {
            id: "n1",
            kind: "note",
            title: "Evening at leisure",
            notes: "Untimed: local markets, food streets, or rest at the stay.",
          },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    expect(content.split("BEGIN:VEVENT").length).toBe(1);
  });

  it("omits timed items when the day has no date", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, undefined, [
          {
            id: "a1",
            kind: "attraction",
            title: "Amber Fort",
            startTime: "09:30",
            endTime: "12:00",
          },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    expect(content.split("BEGIN:VEVENT").length).toBe(1);
  });

  it("escapes special characters in titles", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", [
          {
            id: "a1",
            kind: "attraction",
            title: 'Fort "Red" & Palace',
            startTime: "09:30",
            endTime: "12:00",
          },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    // Quotes should be escaped, ampersand is not a special iCalendar char.
    expect(content).not.toContain('Fort "Red" & Palace');
    expect(content).toContain('SUMMARY:Fort \\"Red\\" & Palace');
  });

  it("generates unique UIDs per event", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", [
          { id: "a1", kind: "attraction", title: "Amber Fort", startTime: "09:30", endTime: "12:00" },
        ]),
        makeDay(2, "2026-11-11", [
          { id: "a1", kind: "attraction", title: "City Palace", startTime: "10:00", endTime: "12:30" },
        ]),
      ],
    };
    const content = buildIcsContentClient(plan);
    const uids = content.match(/UID:.*/g) ?? [];
    expect(uids.length).toBe(2);
    expect(new Set(uids).size).toBe(2);
  });

  it("handles empty itinerary gracefully", () => {
    const plan = {
      destination: "Jaipur",
      days: [
        makeDay(1, "2026-11-10", []),
        makeDay(2, "2026-11-11", []),
        makeDay(3, "2026-11-12", []),
      ],
    };
    const content = buildIcsContentClient(plan);
    expect(content).toContain("BEGIN:VCALENDAR");
    expect(content).toContain("END:VCALENDAR");
    expect(content.split("BEGIN:VEVENT").length).toBe(1);
  });
});

describe("icsFilenameClient", () => {
  it("produces a safe filename from the destination", () => {
    expect(icsFilenameClient("Jaipur")).toBe("ghoomai-jaipur-itinerary.ics");
    expect(icsFilenameClient("New York, NY")).toBe("ghoomai-new-york-ny-itinerary.ics");
  });
});
