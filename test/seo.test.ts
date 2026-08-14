import { describe, it, expect } from "vitest";
import {
  sanitizeTag,
  sanitizeTitle,
  trimToWord,
  buildTags,
  MAX_TAG_CHARS,
  MAX_TITLE_CHARS,
  TAG_COUNT,
} from "../src/publisher/seo.js";

const meta = { niche: "funny halloween shirt", product: "tshirt" as const };

describe("sanitizeTag", () => {
  it("strips the comma Etsy reads as a separator", () => {
    expect(sanitizeTag("dad's day, funny")).toBe("dad's day funny");
  });

  it("keeps letters, numbers, spaces, hyphens and apostrophes", () => {
    expect(sanitizeTag("cat-mom 2026 o'clock")).toBe("cat-mom 2026 o'clock");
  });

  it("removes punctuation Etsy rejects and collapses the gap", () => {
    expect(sanitizeTag("spooky | season / vibes")).toBe("spooky season vibes");
  });

  it("keeps accented letters instead of gutting the word", () => {
    expect(sanitizeTag("piñata cumpleaños")).toBe("piñata cumpleaños");
  });

  it("caps at the Etsy tag limit", () => {
    expect(sanitizeTag("a".repeat(40))).toHaveLength(MAX_TAG_CHARS);
  });

  // These four shipped to the live store as half-words and matched nothing on Etsy.
  it("drops whole words instead of slicing mid-word", () => {
    expect(sanitizeTag("Pregnant Announcement")).toBe("Pregnant");
    expect(sanitizeTag("Minimalist Baby Announcement")).toBe("Minimalist Baby");
    expect(sanitizeTag("Funny Halloween Shirt")).toBe("Funny Halloween");
    expect(sanitizeTag("Halloween Baby Reveal")).toBe("Halloween Baby");
  });

  it("never emits a tag ending in a partial word", () => {
    for (const s of ["Pregnant Announcement", "Spooky Season Maternity Tee", "Autumn Baby Reveal Shirt"]) {
      const t = sanitizeTag(s);
      expect(s.split(" ")).toContain(t.split(" ").pop());
    }
  });

  it("returns empty for a tag with nothing usable left, so callers can drop it", () => {
    expect(sanitizeTag("!!! ***")).toBe("");
  });

  it("never leaves trailing space after the length cap", () => {
    const t = sanitizeTag("halloween pregnancy announcement");
    expect(t).toBe(t.trim());
  });
});

describe("sanitizeTitle", () => {
  // The real title Printify rejected with 61003 "Title contains excessive caps".
  const rejected =
    "Halloween Nurse Shirt Spooky Skeleton Hand EKG Tee Vintage Distressed RN Gift " +
    "ER ICU L&D Nursing Apparel Medical Staff Top";

  it("keeps only the first acronym of a pile-up", () => {
    const out = sanitizeTitle(rejected);
    expect(out).toContain("EKG");
    expect(out).not.toContain("RN");
    expect(out).not.toContain("ICU");
    expect(out).not.toContain("L&D");
  });

  it("leaves a title with a single acronym untouched", () => {
    const ok = "Night Shift Undead Nurse Halloween Shirt | Funny Zombie RN Tee";
    expect(sanitizeTitle(ok)).toBe(ok);
  });

  it("lowercases connector words but never the first one", () => {
    expect(sanitizeTitle("The Nurse Shirt For Halloween And Fall")).toBe(
      "The Nurse Shirt for Halloween and Fall"
    );
  });

  it("does not leave doubled separators where a token was dropped", () => {
    // ER survives as the first acronym; ICU goes, and must not leave "| |" behind.
    expect(sanitizeTitle("Nurse Tee | ER | ICU | Gift")).toBe("Nurse Tee | ER | Gift");
    expect(sanitizeTitle("Nurse Tee, ER, ICU, Gift")).toBe("Nurse Tee, ER, Gift");
  });

  it("does not strip a hyphen inside a word", () => {
    expect(sanitizeTitle("Cat-Mom Halloween Tee")).toBe("Cat-Mom Halloween Tee");
  });

  it("still enforces the Etsy title limit", () => {
    expect(sanitizeTitle("Nurse ".repeat(50)).length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
  });
});

describe("trimToWord", () => {
  it("leaves a short title untouched", () => {
    expect(trimToWord("Short title", 140)).toBe("Short title");
  });

  it("cuts on a word boundary instead of mid-word", () => {
    expect(trimToWord("pregnant halloween announcement shirt", 20)).toBe("pregnant halloween");
  });

  it("hard-cuts when a single word overruns the limit", () => {
    expect(trimToWord("supercalifragilistic", 10)).toBe("supercalif");
  });
});

describe("buildTags", () => {
  // The bug this locks: the fallback padded with `while (len < 13) push(productName)`,
  // emitting the same tag repeatedly. Etsy rejects duplicate tags.
  it("never repeats a tag when the preferred list is short", () => {
    const tags = buildTags(["one tag"], meta);
    expect(tags).toHaveLength(TAG_COUNT);
    expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(TAG_COUNT);
  });

  it("returns exactly 13 tags from an empty preferred list", () => {
    expect(buildTags([], meta)).toHaveLength(TAG_COUNT);
  });

  it("caps at 13 when handed more than enough", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag number ${i}`);
    expect(buildTags(many, meta)).toHaveLength(TAG_COUNT);
  });

  it("keeps the preferred tags first — they are the ranked ones", () => {
    const tags = buildTags(["witch cat shirt", "spooky mom tee"], meta);
    expect(tags[0]).toBe("witch cat shirt");
    expect(tags[1]).toBe("spooky mom tee");
  });

  it("dedups case-insensitively, the way Etsy compares them", () => {
    const tags = buildTags(["Spooky Season", "spooky season", "SPOOKY SEASON"], meta);
    expect(tags.filter((t) => t.toLowerCase() === "spooky season")).toHaveLength(1);
  });

  it("sanitizes before deduping, so two tags that differ only in punctuation collapse", () => {
    const tags = buildTags(["cat mom", "cat, mom"], meta);
    expect(tags.filter((t) => t.toLowerCase() === "cat mom")).toHaveLength(1);
  });

  it("drops a tag that sanitizes to nothing instead of emitting a blank", () => {
    expect(buildTags(["###", "real tag"], meta).every((t) => t.length > 0)).toBe(true);
  });

  it("holds every tag to the Etsy character limit", () => {
    const tags = buildTags(["a".repeat(50)], meta);
    for (const t of tags) expect(t.length).toBeLessThanOrEqual(MAX_TAG_CHARS);
  });

  it("prefers mined competitor terms over generic filler when padding", () => {
    const tags = buildTags(["one tag"], meta, ["proven search term"]);
    expect(tags[1]).toBe("proven search term");
  });
});
