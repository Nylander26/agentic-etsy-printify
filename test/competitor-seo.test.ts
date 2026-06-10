import { describe, it, expect } from "vitest";
import { mineCompetitorKeywords } from "../src/publisher/competitor-seo.js";

const CAT_TITLES = [
  "Funny Cat Mom Shirt, Cat Lover Gift, Crazy Cat Lady Tee",
  "Cat Mom T-Shirt - Cat Lover Gift for Women - Cute Cat Mama Shirt",
  "Crazy Cat Lady Shirt, Cat Mom Gift, Funny Cat Lover Tee",
  "Cat Lover Gift, Cat Mom Shirt, Kitten Mama T-Shirt, Cat Owner Present",
  "Personalized Cat Mom Shirt with Cat Names, Cat Lover Gift",
];

describe("mineCompetitorKeywords", () => {
  it("surfaces high-frequency buyer phrases as bigrams", () => {
    const kws = mineCompetitorKeywords(CAT_TITLES);
    expect(kws).toContain("cat mom");
    expect(kws).toContain("cat lover");
    expect(kws).toContain("cat lady");
  });

  it("drops bigrams that lead with a product noun (title-boundary noise)", () => {
    const kws = mineCompetitorKeywords(CAT_TITLES);
    expect(kws).not.toContain("shirt cat");
    expect(kws.some((k) => k.startsWith("shirt "))).toBe(false);
  });

  it("returns [] for thin data (fewer than minTitles)", () => {
    expect(mineCompetitorKeywords(["Single Cat Shirt"])).toEqual([]);
    expect(mineCompetitorKeywords([])).toEqual([]);
  });

  it("ignores empty/blank titles", () => {
    expect(mineCompetitorKeywords(["", "   ", ""])).toEqual([]);
  });

  it("respects the max cap", () => {
    expect(mineCompetitorKeywords(CAT_TITLES, 3).length).toBeLessThanOrEqual(3);
  });

  it("dedups a keyword-stuffed single title (per-title frequency)", () => {
    // 'cat mom' repeated in ONE title must not qualify on its own (needs >= minTitles titles).
    const stuffed = ["Cat Mom Cat Mom Cat Mom Cat Mom Shirt"];
    expect(mineCompetitorKeywords(stuffed)).toEqual([]);
  });
});
