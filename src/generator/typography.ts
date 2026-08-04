import opentype from "opentype.js";
import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

/**
 * Vector typography compositor.
 *
 * The image model draws the ARTWORK; the words are rendered here from a real font
 * file, as SVG outlines, at the final print resolution. Two things that buys us:
 *
 *  1. Sharpness. Gemini emits 2048px; Printify DTG wants 4500×5400, so anything the
 *     model draws is interpolated ×2.2 before it reaches the press. Glyphs rendered
 *     here are rasterised at 4500 natively — no upscale, no soft edges.
 *  2. Determinism. No garbled letters, no misspellings, no "which font did it feel
 *     like today". The brand's typographic rules become enforceable instead of a
 *     wish inside a prompt.
 *
 * Fonts are outlined to paths via opentype.js rather than handed to libvips/Pango,
 * so rendering does not depend on fontconfig or on anything being installed on the
 * host — same bytes in, same pixels out, on any machine.
 */

const FONTS_DIR = join(
  fileURLToPath(new URL("../../", import.meta.url)),
  "assets",
  "fonts"
);

/** Bundled faces. All SIL OFL — see assets/fonts/OFL.txt. */
export const FONT_FILES = {
  anton: "Anton-Regular.ttf",              // condensed heavy sans — varsity / impact
  "alfa-slab": "AlfaSlabOne-Regular.ttf",  // chunky retro slab
  bebas: "BebasNeue-Regular.ttf",          // tall condensed caps
  pacifico: "Pacifico-Regular.ttf",        // retro brush script
  abril: "AbrilFatface-Regular.ttf",       // high-contrast display serif
  lato: "Lato-Bold.ttf",                   // clean supporting sans
} as const;

export type FontKey = keyof typeof FONT_FILES;

export const FONT_KEYS = Object.keys(FONT_FILES) as FontKey[];

export interface TypographyLine {
  text: string;
  font: FontKey;
  /** CSS hex, e.g. "#0D0D0D". */
  color: string;
  uppercase?: boolean;
  /** Letter spacing in em. Display caps usually want a touch of positive tracking. */
  tracking?: number;
  /**
   * Width this line occupies relative to the text box, 0-1. Lets a stack read as
   * designed (a wide headline over a narrow kicker) instead of every line being
   * stretched to the same measure.
   */
  widthRatio?: number;
  /** Outline drawn behind the fill — the classic POD contrast trick. */
  stroke?: { color: string; width: number };
}

export interface TypographySpec {
  lines: TypographyLine[];
  /**
   * Text box as fractions of the canvas. Defaults reserve the lower third, which is
   * what the art prompt is told to leave empty.
   */
  box?: { top?: number; height?: number; sideMargin?: number };
  /** Vertical gap between lines, as a fraction of the box height. */
  lineGap?: number;
}

export interface Canvas {
  width: number;
  height: number;
}

const DEFAULT_BOX = { top: 0.66, height: 0.28, sideMargin: 0.1 };
const DEFAULT_LINE_GAP = 0.06;
/** Glyphs are outlined at this em size, then transformed. Keeps path data precise. */
const REF_SIZE = 1000;

const fontCache = new Map<FontKey, opentype.Font>();

export function loadFont(key: FontKey): opentype.Font {
  const cached = fontCache.get(key);
  if (cached) return cached;

  const file = FONT_FILES[key];
  if (!file) throw new Error(`Unknown font "${key}". Available: ${FONT_KEYS.join(", ")}`);

  const buf = readFileSync(join(FONTS_DIR, file));
  // opentype wants a standalone ArrayBuffer, not a slice of Node's shared pool.
  const font = opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  fontCache.set(key, font);
  return font;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string
  );
}

interface LaidOutLine {
  pathData: string;
  /** Transform mapping the REF-size path into canvas coordinates. */
  scale: number;
  tx: number;
  ty: number;
  inkWidth: number;
  inkHeight: number;
  line: TypographyLine;
}

/**
 * Measures each line's actual ink box (not font metrics) and scales it to the
 * requested share of the text box. Ink bounds are what the eye reads as "aligned";
 * ascender/descender metrics would leave display caps looking randomly indented.
 */
function layout(spec: TypographySpec, canvas: Canvas): LaidOutLine[] {
  const box = { ...DEFAULT_BOX, ...(spec.box ?? {}) };
  const boxX = canvas.width * box.sideMargin;
  const boxW = canvas.width * (1 - 2 * box.sideMargin);
  const boxY = canvas.height * box.top;
  const boxH = canvas.height * box.height;
  const gap = boxH * (spec.lineGap ?? DEFAULT_LINE_GAP);

  const measured = spec.lines.map((line) => {
    const font = loadFont(line.font);
    // Opt-in, not opt-out: script faces (Pacifico) and mixed-case display serifs
    // look wrong shouted, so the caller's casing is respected by default.
    const text = line.uppercase ? line.text.toUpperCase() : line.text;
    const path = font.getPath(text, 0, 0, REF_SIZE, {
      kerning: true,
      letterSpacing: line.tracking ?? 0,
    } as opentype.RenderOptions);
    const bb = path.getBoundingBox();
    return {
      line,
      pathData: path.toPathData(2),
      x1: bb.x1,
      y1: bb.y1,
      inkW: bb.x2 - bb.x1,
      inkH: bb.y2 - bb.y1,
    };
  });

  // Fit each line to its share of the measure, then shrink the whole stack uniformly
  // if it overflows the box vertically. Scaling the stack (rather than clipping or
  // re-fitting per line) preserves the size relationships between lines.
  const scales = measured.map((m) => {
    const targetW = boxW * (m.line.widthRatio ?? 1);
    return m.inkW > 0 ? targetW / m.inkW : 0;
  });

  const stackH = measured.reduce((sum, m, i) => sum + m.inkH * (scales[i] as number), 0)
    + gap * Math.max(0, measured.length - 1);
  const overflow = stackH > boxH ? boxH / stackH : 1;

  let cursor = boxY + (boxH - stackH * overflow) / 2;
  return measured.map((m, i) => {
    const s = (scales[i] as number) * overflow;
    const w = m.inkW * s;
    const h = m.inkH * s;
    const tx = boxX + (boxW - w) / 2 - m.x1 * s;
    const ty = cursor - m.y1 * s;
    cursor += h + gap * overflow;
    return { pathData: m.pathData, scale: s, tx, ty, inkWidth: w, inkHeight: h, line: m.line };
  });
}

/** Builds the SVG for the text layer. Exported for tests and for eyeballing output. */
export function buildTypographySvg(spec: TypographySpec, canvas: Canvas): string {
  if (!spec.lines.length) {
    throw new Error("TypographySpec needs at least one line");
  }

  const parts = layout(spec, canvas).map((l) => {
    const { stroke } = l.line;
    // stroke-width lives in pre-transform units, so divide by the scale to land on
    // the requested visual thickness in canvas pixels.
    const strokeAttrs = stroke
      ? ` stroke="${escapeXml(stroke.color)}" stroke-width="${(stroke.width / l.scale).toFixed(2)}"` +
        ` stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`
      : "";
    return (
      `<g transform="translate(${l.tx.toFixed(2)},${l.ty.toFixed(2)}) scale(${l.scale.toFixed(6)})">` +
      `<path d="${l.pathData}" fill="${escapeXml(l.line.color)}"${strokeAttrs}/>` +
      `</g>`
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" ` +
    `viewBox="0 0 ${canvas.width} ${canvas.height}">${parts.join("")}</svg>`
  );
}

/** Rasterises the text layer on its own transparent canvas. */
export async function renderTypographyLayer(
  spec: TypographySpec,
  canvas: Canvas
): Promise<Buffer> {
  const svg = buildTypographySvg(spec, canvas);
  return sharp(Buffer.from(svg), { density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Composites the text layer over already print-sized artwork.
 *
 * Call this LAST — after background removal and after the resize to Printify
 * dimensions. Compositing before the resize would put the glyphs back through the
 * same interpolation this module exists to avoid.
 */
export async function compositeTypography(
  artBuffer: Buffer,
  spec: TypographySpec,
  canvas: Canvas
): Promise<Buffer> {
  const layer = await renderTypographyLayer(spec, canvas);
  return sharp(artBuffer)
    .composite([{ input: layer, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
