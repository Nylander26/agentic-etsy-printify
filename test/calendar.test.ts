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

  it("drops events whose purchase window closes inside the publish lead time", () => {
    // 2026-06-08 — the day the Father's Day batch actually went live. The event is
    // June 21, so the window closes days later: no runway for a new listing to rank.
    const publishedOn = new Date(2026, 5, 8);

    const withoutGate = getUpcomingEvents(publishedOn, 60).find((e) => e.id === "fathers-day");
    expect(withoutGate).toBeDefined();

    const withGate = getUpcomingEvents(publishedOn, 60, 30).find((e) => e.id === "fathers-day");
    expect(withGate).toBeUndefined();
  });

  it("keeps events that still have enough runway", () => {
    // Early August: Halloween's window closes far enough out to be worth seeding.
    const august = new Date(2026, 7, 4);
    const halloween = getUpcomingEvents(august, 120, 30).find((e) => e.id === "halloween");
    expect(halloween).toBeDefined();
    expect(halloween!.daysUntilWindowClose).toBeGreaterThanOrEqual(30);
  });

  it("minLeadDays=0 preserves the previous behavior", () => {
    expect(getUpcomingEvents(today, 400, 0)).toEqual(getUpcomingEvents(today, 400));
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
