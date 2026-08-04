import { generateText } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { FONT_KEYS, type FontKey, type TypographyLine, type TypographySpec } from "./typography.js";
import {
  garmentToneForVariation,
  pickContrastingInk,
  contrastRatio,
  type GarmentTone,
} from "../lib/garment.js";
import type { VariationKind } from "./types.js";

/**
 * Decides HOW the words are set: which lines, which face, which ink, which emphasis.
 *
 * Gemini proposes; this module disposes. Everything coming back is clamped to the
 * fonts and palette in config before it can reach the renderer, so a hallucinated
 * font name or an off-brand hex can't get through to a print file. If the call
 * fails outright there is a deterministic fallback, because a design pipeline that
 * stops when a text model has a bad minute is not a pipeline.
 */

/** Words we never want set as the headline — they describe art, they aren't the joke. */
const ART_DIRECTION_NOISE =
  /\b(illustration|vector|graphic|design|artwork|retro|vintage|hand[- ]drawn|style|aesthetic|t[- ]?shirt|print)\b/gi;

export interface TypeDirectionInput {
  concept: string;
  style: string;
  niche: string;
  variation: VariationKind;
}

function isFontKey(v: unknown): v is FontKey {
  return typeof v === "string" && (FONT_KEYS as string[]).includes(v);
}

function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(s) ? s : null;
}

/**
 * Pulls the printable phrase out of a concept string. Concepts arrive as a mix of
 * slogan and art direction ("The Grillfather, retro BBQ illustration with flames"),
 * so anything after the first clause and any art-direction vocabulary is dropped.
 */
export function sloganFromConcept(concept: string): string {
  const firstClause = (concept.split(/[,;:—–]|\s+-\s+/)[0] ?? concept).trim();
  const cleaned = firstClause.replace(ART_DIRECTION_NOISE, "").replace(/\s{2,}/g, " ").trim();
  const slogan = cleaned.length >= 3 ? cleaned : firstClause.trim();
  return slogan.replace(/^["'"']|["'"']$/g, "").trim();
}

/** Splits a slogan into at most `max` balanced lines, breaking on word boundaries. */
export function splitIntoLines(slogan: string, max = 3): string[] {
  const words = slogan.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [slogan];

  const lineCount = Math.min(max, words.length <= 3 ? 2 : 3);
  const perLine = Math.ceil(words.length / lineCount);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) {
    lines.push(words.slice(i, i + perLine).join(" "));
  }
  return lines.filter(Boolean);
}

/**
 * Deterministic spec used when Gemini is unavailable or returns junk. Plain but
 * always printable: one face, brand ink, biggest line first.
 */
export function fallbackSpec(input: TypeDirectionInput): TypographySpec {
  const cfg = getConfig().generation.typography;
  const brand = getConfig().brand;
  const font: FontKey = (brand.fonts.includes("anton") ? "anton" : brand.fonts[0]) as FontKey;
  const tone = garmentToneForVariation(input.variation);
  // Highest-contrast ink in the palette for this garment — no hardcoded hex, so
  // re-theming the palette can't strand the fallback on an invisible color.
  const ink = pickContrastingInk(brand.palette, tone);

  const lines = splitIntoLines(sloganFromConcept(input.concept));
  return {
    box: { top: cfg.box_top, height: cfg.box_height, sideMargin: cfg.side_margin },
    lineGap: cfg.line_gap,
    lines: lines.map((text, i) => ({
      text,
      font,
      color: ink,
      uppercase: true,
      // Taper secondary lines so the stack reads as a composition, not a paragraph.
      widthRatio: i === 0 ? 1 : 0.82,
    })),
  };
}

const DIRECTOR_PROMPT = (
  input: TypeDirectionInput,
  fonts: string[],
  palette: string[],
  tone: GarmentTone
) => `
You are a typographer laying out the text of a print-on-demand t-shirt graphic.
The illustration is generated separately and sits ABOVE your text block. You only
decide the words' typographic treatment.

Niche: "${input.niche}"
Concept: "${input.concept}"
Style hint: "${input.style}"
Variation: ${input.variation} — this design prints on ${tone.toUpperCase()} garments, so the ink must be ${tone === "dark" ? "LIGHT" : "DARK"}

Extract the printable slogan from the concept — the words a buyer would actually
wear. Drop art direction (colors, "illustration", "retro style", product names).

Available fonts (use the key verbatim):
${fonts.map((f) => `- ${f}`).join("\n")}
  anton / bebas = condensed heavy caps, loud and modern
  alfa-slab = chunky retro slab, warm and friendly
  abril = high-contrast display serif, premium
  pacifico = brush script — ONLY for short supporting lines, never a full slogan
  lato = clean sans, for small kickers and supporting text

Available ink colors (use the hex verbatim): ${palette.join(", ")}

Rules:
- 1 to 3 lines. One line must clearly dominate; the others support it.
- At most 2 different fonts across the whole stack.
- Script (pacifico) is never uppercase and never the dominant line.
- widthRatio is how much of the text box's width that line fills: dominant line
  1.0, supporting lines 0.5-0.85. This is what creates hierarchy.
- tracking (em) only on small uppercase kickers, 0.15-0.35. Never on display lines.
- Ink must contrast hard against a ${tone} garment. Anything too close in value to
  the garment is rejected downstream and replaced, so pick boldly.
- Optional "stroke" {color, width} only when it genuinely helps contrast. width is
  in pixels on a 4500px-wide canvas, so 12-30.

Return ONLY a JSON object, no markdown fence, no commentary:
{"lines":[{"text":"...","font":"anton","color":"#0D0D0D","uppercase":true,"widthRatio":1.0}]}
`.trim();

function parseLines(raw: string): unknown[] | null {
  // Gemini fences JSON about half the time; take the outermost object either way.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { lines?: unknown };
    return Array.isArray(obj.lines) ? obj.lines : null;
  } catch {
    return null;
  }
}

/**
 * Clamps a model-proposed line to something the renderer can safely print.
 * Returns null when the line has no usable text at all.
 */
function sanitizeLine(
  raw: unknown,
  allowedFonts: FontKey[],
  allowedPalette: string[],
  index: number,
  tone: GarmentTone
): TypographyLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text) return null;

  const font: FontKey = isFontKey(r.font) && allowedFonts.includes(r.font)
    ? r.font
    : (allowedFonts[0] as FontKey);

  // Two gates on ink, in order: it must be a palette color (brand), and it must
  // clear the contrast bar against the worst garment in this tone (legibility).
  // The model gets asked for the right thing in the prompt; this is what makes it
  // true. A design that reaches print with unreadable text is a wasted listing.
  const proposed = normalizeHex(r.color);
  const inPalette =
    proposed && allowedPalette.some((p) => p.toUpperCase() === proposed) ? proposed : undefined;
  const color = pickContrastingInk(allowedPalette, tone, inPalette);

  // Script faces are drawn with lowercase forms; shouting them destroys the face.
  const uppercase = font === "pacifico" ? false : r.uppercase !== false;

  const widthRatio =
    typeof r.widthRatio === "number" && r.widthRatio > 0.15 && r.widthRatio <= 1
      ? r.widthRatio
      : index === 0
        ? 1
        : 0.8;

  const tracking =
    typeof r.tracking === "number" && r.tracking >= 0 && r.tracking <= 0.5
      ? r.tracking
      : undefined;

  const line: TypographyLine = { text, font, color, uppercase, widthRatio };
  if (tracking !== undefined) line.tracking = tracking;

  const s = r.stroke as Record<string, unknown> | undefined;
  const strokeColor = normalizeHex(s?.color);
  const strokeWidth = typeof s?.width === "number" ? s.width : NaN;
  // An outline the same value as the fill is invisible work that only fattens the
  // glyphs; keep it only when it actually separates from the ink.
  if (
    strokeColor &&
    strokeWidth >= 4 &&
    strokeWidth <= 60 &&
    contrastRatio(strokeColor, color) >= 1.5
  ) {
    line.stroke = { color: strokeColor, width: strokeWidth };
  }

  return line;
}

export async function buildTypographySpec(
  input: TypeDirectionInput
): Promise<TypographySpec> {
  const cfg = getConfig().generation.typography;
  const brand = getConfig().brand;
  const fonts = brand.fonts as FontKey[];
  const palette = brand.palette;
  const tone = garmentToneForVariation(input.variation);

  let lines: TypographyLine[] = [];
  try {
    const raw = await generateText(DIRECTOR_PROMPT(input, fonts, palette, tone));
    const parsed = parseLines(raw);
    if (parsed) {
      lines = parsed
        .slice(0, 3)
        .map((l, i) => sanitizeLine(l, fonts, palette, i, tone))
        .filter((l): l is TypographyLine => l !== null);
    }
  } catch {
    // fall through to the deterministic layout
  }

  if (!lines.length) return fallbackSpec(input);

  // Enforce the style guide's typeface cap even when the model ignores it: keep the
  // first `max_typefaces` distinct faces in reading order, remap the rest onto the
  // last kept face.
  const faces = [...new Set(lines.map((l) => l.font))];
  if (faces.length > brand.max_typefaces) {
    const kept = faces.slice(0, brand.max_typefaces);
    const fallbackFace = kept[kept.length - 1] as FontKey;
    lines = lines.map((l) => (kept.includes(l.font) ? l : { ...l, font: fallbackFace }));
  }

  return {
    box: { top: cfg.box_top, height: cfg.box_height, sideMargin: cfg.side_margin },
    lineGap: cfg.line_gap,
    lines,
  };
}
