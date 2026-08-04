import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  buildTypographySvg,
  renderTypographyLayer,
  loadFont,
  FONT_KEYS,
  type TypographySpec,
} from "../src/generator/typography.js";
import {
  sloganFromConcept,
  splitIntoLines,
  fallbackSpec,
} from "../src/generator/type-director.js";
import { relativeLuminance } from "../src/lib/garment.js";

const CANVAS = { width: 4500, height: 5400 };

/** Pulls the numbers out of `translate(tx,ty) scale(s)` for geometry assertions. */
function transforms(svg: string): { tx: number; ty: number; scale: number }[] {
  const re = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/g;
  const out: { tx: number; ty: number; scale: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    out.push({ tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) });
  }
  return out;
}

describe("fonts", () => {
  it("every bundled face parses and outlines glyphs", () => {
    for (const key of FONT_KEYS) {
      const font = loadFont(key);
      const path = font.getPath("Handgloves 123", 0, 0, 100);
      const bb = path.getBoundingBox();
      expect(bb.x2 - bb.x1, `${key} produced no ink`).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown face instead of silently substituting one", () => {
    // A wrong font must fail loudly — a silent fallback would ship an off-brand print.
    expect(() => loadFont("helvetica" as never)).toThrow(/Unknown font/);
  });
});

describe("buildTypographySvg", () => {
  const spec: TypographySpec = {
    lines: [
      { text: "The", font: "lato", color: "#EDEDED", uppercase: true, widthRatio: 0.3 },
      { text: "Grillfather", font: "anton", color: "#C9A96E", uppercase: true },
    ],
  };

  it("emits a canvas matching the print dimensions", () => {
    const svg = buildTypographySvg(spec, CANVAS);
    expect(svg).toContain('width="4500"');
    expect(svg).toContain('height="5400"');
    expect(svg).toContain('viewBox="0 0 4500 5400"');
  });

  it("draws one group per line and keeps the requested inks", () => {
    const svg = buildTypographySvg(spec, CANVAS);
    expect(transforms(svg)).toHaveLength(2);
    expect(svg).toContain('fill="#EDEDED"');
    expect(svg).toContain('fill="#C9A96E"');
  });

  it("throws on an empty stack rather than emitting a blank layer", () => {
    expect(() => buildTypographySvg({ lines: [] }, CANVAS)).toThrow(/at least one line/);
  });

  it("keeps every line inside the text box", () => {
    const box = { top: 0.6, height: 0.3, sideMargin: 0.1 };
    const svg = buildTypographySvg({ ...spec, box }, CANVAS);
    const boxTop = CANVAS.height * box.top;
    const boxBottom = boxTop + CANVAS.height * box.height;
    const left = CANVAS.width * box.sideMargin;
    const right = CANVAS.width - left;

    for (const t of transforms(svg)) {
      // ty is the baseline-ish anchor and tx the pre-ink-offset origin, so allow the
      // generous slack a glyph's own bearings introduce; the point is gross overflow.
      expect(t.ty).toBeGreaterThan(boxTop - 100);
      expect(t.ty).toBeLessThan(boxBottom + 100);
      expect(t.tx).toBeGreaterThan(left - CANVAS.width * 0.1);
      expect(t.tx).toBeLessThan(right);
    }
  });

  it("scales a stack that would overflow instead of letting it spill", () => {
    const tall: TypographySpec = {
      box: { top: 0.7, height: 0.06, sideMargin: 0.05 },
      lines: [
        { text: "One", font: "anton", uppercase: true, color: "#0D0D0D" },
        { text: "Two", font: "anton", uppercase: true, color: "#0D0D0D" },
        { text: "Three", font: "anton", uppercase: true, color: "#0D0D0D" },
      ],
    };
    const roomy = buildTypographySvg({ ...tall, box: { ...tall.box, height: 0.4 } }, CANVAS);
    const cramped = buildTypographySvg(tall, CANVAS);
    const maxScale = (svg: string) => Math.max(...transforms(svg).map((t) => t.scale));
    expect(maxScale(cramped)).toBeLessThan(maxScale(roomy));
  });

  it("gives the dominant line more measure than its supporting line", () => {
    const svg = buildTypographySvg(
      {
        lines: [
          { text: "SAME", font: "anton", color: "#0D0D0D", widthRatio: 0.5 },
          { text: "SAME", font: "anton", color: "#0D0D0D", widthRatio: 1 },
        ],
      },
      CANVAS
    );
    const [kicker, headline] = transforms(svg);
    // Identical text and face, so the scale ratio is purely widthRatio's doing.
    expect(headline!.scale).toBeGreaterThan(kicker!.scale * 1.8);
  });

  it("divides stroke width by the scale so the outline lands at the asked-for pixels", () => {
    const svg = buildTypographySvg(
      {
        lines: [
          {
            text: "OUTLINED",
            font: "bebas",
            color: "#0D0D0D",
            stroke: { color: "#C9A96E", width: 20 },
          },
        ],
      },
      CANVAS
    );
    const scale = transforms(svg)[0]!.scale;
    const declared = Number(/stroke-width="([\d.]+)"/.exec(svg)![1]);
    expect(declared * scale).toBeCloseTo(20, 0);
    expect(svg).toContain('paint-order="stroke"');
  });

  it("escapes text that would otherwise break the SVG", () => {
    const svg = buildTypographySvg(
      { lines: [{ text: "Dad & Co", font: "lato", color: "#0D0D0D" }] },
      CANVAS
    );
    expect(svg).not.toMatch(/fill="[^"]*&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe("renderTypographyLayer", () => {
  it("rasterises a transparent layer at exactly the print size", async () => {
    const buf = await renderTypographyLayer(
      { lines: [{ text: "Grillfather", font: "anton", color: "#C9A96E", uppercase: true }] },
      CANVAS
    );
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(CANVAS.width);
    expect(meta.height).toBe(CANVAS.height);
    expect(meta.channels).toBe(4);
  });
});

describe("sloganFromConcept", () => {
  it("keeps the wearable phrase and drops the art direction", () => {
    expect(
      sloganFromConcept("The Grillfather, retro BBQ illustration with flames")
    ).toBe("The Grillfather");
  });

  it("strips art-direction vocabulary that leaks into the first clause", () => {
    expect(sloganFromConcept("Reel Cool Dad vintage design")).toBe("Reel Cool Dad");
  });

  it("falls back to the raw clause when stripping would empty it", () => {
    expect(sloganFromConcept("retro vintage design")).not.toBe("");
  });

  it("removes surrounding quotes", () => {
    expect(sloganFromConcept('"Just Resting My Eyes"')).toBe("Just Resting My Eyes");
  });
});

describe("splitIntoLines", () => {
  it("leaves a single word alone", () => {
    expect(splitIntoLines("Grillfather")).toEqual(["Grillfather"]);
  });

  it("splits a short slogan into two lines", () => {
    expect(splitIntoLines("Reel Cool Dad")).toHaveLength(2);
  });

  it("never exceeds the line cap", () => {
    const lines = splitIntoLines("Powered by Dad Jokes and Strong Coffee Every Morning");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(" ")).toBe("Powered by Dad Jokes and Strong Coffee Every Morning");
  });
});

describe("fallbackSpec", () => {
  const input = { concept: "The Grillfather", style: "retro", niche: "funny dad shirt" };

  it("inks light on a dark garment and dark on a light one", () => {
    const dark = fallbackSpec({ ...input, variation: "dark" });
    const base = fallbackSpec({ ...input, variation: "base" });
    // Asserts the direction, not a specific hex — the exact off-white the palette
    // yields is a palette detail, but the polarity must never flip.
    expect(relativeLuminance(dark.lines[0]!.color)).toBeGreaterThan(0.5);
    expect(relativeLuminance(base.lines[0]!.color)).toBeLessThan(0.2);
  });

  it("always produces a printable stack", () => {
    const spec = fallbackSpec({ ...input, variation: "base" });
    expect(spec.lines.length).toBeGreaterThan(0);
    expect(() => buildTypographySvg(spec, CANVAS)).not.toThrow();
  });
});
