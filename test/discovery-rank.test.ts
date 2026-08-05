import { describe, it, expect } from "vitest";
import { compareByRunway, type DiscoveredNiche } from "../src/research/discovery.js";
import type { EventUrgency } from "../src/research/calendar.js";

function niche(
  keyword: string,
  runwayDays: number | null,
  expectedDemand: number,
  anchorUrgency: EventUrgency | null = "planning"
): DiscoveredNiche {
  return {
    keyword,
    rationale: "",
    expectedDemand,
    anchorEvent: keyword,
    anchorUrgency,
    daysUntilEvent: runwayDays,
    runwayDays,
    source: "auto-discovery",
    sampledListings: 0,
    avgPrice: null,
    avgTitlePreview: [],
  };
}

describe("compareByRunway", () => {
  // The regression this locks is a real batch that failed: Father's Day listings went up
  // 13 days before the event, never ranked, and took 1 visit in two months. The old sort
  // was urgency-first, which puts exactly that candidate at #1 with a star on it.
  it("ranks the candidate with more runway above a more urgent one", () => {
    const closingSoon = niche("back to school shirt", 30, 8, "active");
    const plentyOfTime = niche("halloween shirt", 83, 7, "planning");

    expect([closingSoon, plentyOfTime].sort(compareByRunway)[0]).toBe(plentyOfTime);
  });

  it("does not let a higher demand estimate outrank real runway", () => {
    const hyped = niche("labor day shirt", 30, 10, "active");
    const roomy = niche("halloween shirt", 83, 5, "planning");

    expect([hyped, roomy].sort(compareByRunway)[0]).toBe(roomy);
  });

  it("falls back to demand when runway ties", () => {
    const low = niche("a", 60, 6);
    const high = niche("b", 60, 9);

    expect([low, high].sort(compareByRunway)[0]).toBe(high);
  });

  it("is deterministic when runway and demand both tie", () => {
    const b = niche("b niche", 60, 7);
    const a = niche("a niche", 60, 7);

    expect([b, a].sort(compareByRunway).map((n) => n.keyword)).toEqual(["a niche", "b niche"]);
    expect([a, b].sort(compareByRunway).map((n) => n.keyword)).toEqual(["a niche", "b niche"]);
  });

  it("sinks evergreen candidates with no window below dated ones", () => {
    const evergreen = niche("cat lover shirt", null, 10, null);
    const dated = niche("halloween shirt", 40, 5);

    expect([evergreen, dated].sort(compareByRunway)[0]).toBe(dated);
  });

  it("orders a full list by runway descending", () => {
    const list = [
      niche("back to school", 30, 8, "active"),
      niche("halloween", 83, 7, "planning"),
      niche("labor day", 30, 7, "planning"),
      niche("thanksgiving", 110, 6, "planning"),
    ];

    expect(list.sort(compareByRunway).map((n) => n.keyword)).toEqual([
      "thanksgiving",
      "halloween",
      "back to school",
      "labor day",
    ]);
  });
});
