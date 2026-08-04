import { describe, it, expect } from "vitest";
import {
  garmentToneForVariation,
  relativeLuminance,
  contrastRatio,
  inkIsLegible,
  pickContrastingInk,
  GARMENT_SWATCHES,
  worstContrast,
  MIN_INK_CONTRAST,
} from "../src/lib/garment.js";
import { tshirtVariantsForVariation } from "../src/publisher/blueprint-map.js";
import { fallbackSpec } from "../src/generator/type-director.js";
import { getConfig } from "../src/lib/config.js";

describe("garmentToneForVariation", () => {
  it("sends the light-artwork variation to dark garments", () => {
    expect(garmentToneForVariation("dark")).toBe("dark");
  });

  it("sends every other variation to light garments", () => {
    expect(garmentToneForVariation("base")).toBe("light");
    expect(garmentToneForVariation("no-text")).toBe("light");
    expect(garmentToneForVariation("minimal")).toBe("light");
  });
});

describe("publisher / typography agreement", () => {
  // The bug this locks: garment colors and ink were chosen from the same string in
  // two files with no link. Change one set and text silently prints invisible.
  it("gives dark and light variations disjoint garment sets", () => {
    const dark = tshirtVariantsForVariation("dark").map((v) => v.id);
    const base = tshirtVariantsForVariation("base").map((v) => v.id);
    expect(dark.length).toBeGreaterThan(0);
    expect(base.length).toBeGreaterThan(0);
    expect(dark.filter((id) => base.includes(id))).toEqual([]);
  });

  it("routes no-text to the same garments as base", () => {
    expect(tshirtVariantsForVariation("no-text")).toEqual(tshirtVariantsForVariation("base"));
  });

  it("picks an ink that is legible on the garments the publisher will use", () => {
    for (const variation of ["base", "dark", "no-text"] as const) {
      const spec = fallbackSpec({
        concept: "The Grillfather",
        style: "retro",
        niche: "funny dad shirt",
        variation,
      });
      const tone = garmentToneForVariation(variation);
      for (const line of spec.lines) {
        expect(
          inkIsLegible(line.color, tone),
          `${variation}: ${line.color} unreadable on ${tone} garments`
        ).toBe(true);
      }
    }
  });
});

describe("contrast math", () => {
  it("matches known WCAG anchors", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0D0D0D", "#9B9B9B")).toBeCloseTo(
      contrastRatio("#9B9B9B", "#0D0D0D"),
      6
    );
  });

  it("orders luminance the way the eye does", () => {
    expect(relativeLuminance("#FFFFFF")).toBeGreaterThan(relativeLuminance("#888888"));
    expect(relativeLuminance("#888888")).toBeGreaterThan(relativeLuminance("#0D0D0D"));
  });

  it("rejects malformed hex instead of coercing it", () => {
    expect(() => relativeLuminance("nope")).toThrow(/hex/);
    expect(() => relativeLuminance("#FFF")).toThrow(/hex/);
  });
});

describe("pickContrastingInk", () => {
  const palette = getConfig().brand.palette;

  it("keeps the preferred ink when it is already legible", () => {
    expect(pickContrastingInk(palette, "light", "#0D0D0D")).toBe("#0D0D0D");
  });

  it("overrides a preferred ink that would vanish into the garment", () => {
    // Muted grey on a heather-grey tee: in palette, still unreadable.
    const chosen = pickContrastingInk(palette, "light", "#888888");
    expect(chosen).not.toBe("#888888");
    expect(inkIsLegible(chosen, "light")).toBe(true);
  });

  it("flips to a light ink for dark garments", () => {
    const chosen = pickContrastingInk(palette, "dark", "#0D0D0D");
    expect(relativeLuminance(chosen)).toBeGreaterThan(relativeLuminance("#888888"));
  });

  it("throws on an empty palette rather than returning undefined", () => {
    expect(() => pickContrastingInk([], "light")).toThrow(/Empty ink palette/);
  });
});

describe("brand palette viability", () => {
  // A palette with no legible ink for a tone would silently ship unreadable shirts
  // on half the catalog, so it is a config error worth failing the build over.
  it("contains a legible ink for both garment tones", () => {
    const palette = getConfig().brand.palette;
    for (const tone of ["light", "dark"] as const) {
      const ok = palette.filter((c) => inkIsLegible(c, tone));
      expect(ok.length, `no ink clears ${MIN_INK_CONTRAST}:1 on ${tone} garments`).toBeGreaterThan(0);
    }
  });

  it("checks every garment in the set, not a single representative", () => {
    // The bug this locks: near-black beats kelly green on contrast, so a one-swatch
    // check approves black ink for the dark set and prints it on the black tee.
    expect(contrastRatio("#0D0D0D", "#4C9A4C")).toBeGreaterThan(MIN_INK_CONTRAST);
    expect(inkIsLegible("#0D0D0D", "dark")).toBe(false);
    expect(worstContrast("#0D0D0D", "dark")).toBeLessThan(1.5);
  });

  it("covers the same number of colors the publisher offers per tone", () => {
    expect(GARMENT_SWATCHES.light).toHaveLength(6);
    expect(GARMENT_SWATCHES.dark).toHaveLength(6);
  });
});
