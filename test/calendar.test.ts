import { describe, it, expect } from "vitest";
import { getUpcomingEvents, inferPodCategory, eventLabel } from "../src/research/calendar.js";

function eventById(today: Date, id: string) {
  return getUpcomingEvents(today, 400).find((e) => e.id === id);
}

describe("getUpcomingEvents — date math", () => {
  const today = new Date(2026, 0, 1); // Jan 1 2026, local

  it("computes fixed-date holidays", () => {
    expect(eventById(today, "fourth-of-july")?.eventDate).toBe("2026-07-04");
    expect(eventById(today, "christmas")?.eventDate).toBe("2026-12-25");
    expect(eventById(today, "valentines")?.eventDate).toBe("2026-02-14");
  });

  it("computes nth-weekday holidays", () => {
    // MLK = 3rd Monday Jan 2026 → Jan 19
    expect(eventById(today, "mlk-day")?.eventDate).toBe("2026-01-19");
    // Father's Day = 3rd Sunday June 2026 → June 21
    expect(eventById(today, "fathers-day")?.eventDate).toBe("2026-06-21");
    // Thanksgiving = 4th Thursday Nov 2026 → Nov 26
    expect(eventById(today, "thanksgiving")?.eventDate).toBe("2026-11-26");
  });

  it("computes last-weekday holidays (Memorial Day = last Monday May 2026 → May 25)", () => {
    expect(eventById(today, "memorial-day")?.eventDate).toBe("2026-05-25");
  });

  it("computes Easter (2026 → April 5)", () => {
    expect(eventById(today, "easter")?.eventDate).toBe("2026-04-05");
  });

  it("excludes events whose purchase window has already closed", () => {
    // On Dec 26 2026, Christmas window is closed; it should not appear (this year).
    const dayAfterXmas = new Date(2026, 11, 26);
    const xmasThisYear = getUpcomingEvents(dayAfterXmas, 5).find(
      (e) => e.id === "christmas" && e.eventDate === "2026-12-25"
    );
    expect(xmasThisYear).toBeUndefined();
  });

  it("sorts by urgency then days-until-event", () => {
    const events = getUpcomingEvents(today, 400);
    const rank = { critical: 0, active: 1, upcoming: 2, planning: 3 } as const;
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const cur = events[i]!;
      expect(rank[prev.urgency]).toBeLessThanOrEqual(rank[cur.urgency]);
    }
  });
});

describe("inferPodCategory", () => {
  it("maps niche keywords to the right POD category", () => {
    expect(inferPodCategory("funny cat mom shirt")).toBe("humor");
    expect(inferPodCategory("american flag veteran tee")).toBe("patriotic");
    expect(inferPodCategory("best teacher gift mug")).toBe("appreciation");
    expect(inferPodCategory("ugly christmas sweater")).toBe("gift");
    expect(inferPodCategory("spooky season halloween")).toBe("seasonal");
  });

  it("returns null when there is no calendar signal", () => {
    expect(inferPodCategory("random abstract art")).toBeNull();
    expect(inferPodCategory("")).toBeNull();
  });
});

describe("eventLabel", () => {
  it("includes the event name and date", () => {
    const ev = eventById(new Date(2026, 0, 1), "fourth-of-july")!;
    const label = eventLabel(ev);
    expect(label).toContain("4th of July");
    expect(label).toContain("2026-07-04");
  });
});
