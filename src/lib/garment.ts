/**
 * Single source of truth for "which garment does this design variation print on,
 * and therefore which ink can survive on it".
 *
 * This used to be an implicit agreement between three places: the publisher picked
 * garment colors off `variation === "dark"`, the type director told Gemini "light
 * ink" off the same string, and the fallback layout hardcoded a third copy. Nothing
 * tied them together, so changing the garment sets would silently ship invisible
 * text. Both sides now import from here, and a test locks the invariant.
 */

export type GarmentTone = "light" | "dark";

/**
 * "dark" artwork is light/cream and goes on DARK garments; everything else
 * (base / no-text) is dark/colored artwork and goes on LIGHT garments.
 */
export function garmentToneForVariation(variation: string): GarmentTone {
  return variation === "dark" ? "dark" : "light";
}

/**
 * Every garment color the publisher can actually pick, per tone — mirrors the six
 * colors in publisher/blueprint-map.ts.
 *
 * An ink must clear the contrast bar against ALL of them, not against a single
 * "representative" swatch. Checking one swatch looks equivalent and is not: near-black
 * ink beats kelly green on contrast, so a single-swatch check happily approves black
 * type for the dark set and then prints it, invisibly, on the black tee sitting in
 * that same set.
 *
 * Hexes are eyeballed approximations of the Bella+Canvas 3001 swatches, not values
 * sampled from Printify, and lean pessimistic. To tighten them, pull the catalog
 * variant colors from the Printify API and replace these.
 */
export const GARMENT_SWATCHES: Record<GarmentTone, string[]> = {
  light: ["#FFFFFF", "#E8DCC8", "#F2E8D5", "#F2D4DC", "#D8D8D8", "#9B9B9B"],
  dark: ["#1A1A1A", "#26303F", "#3B2E2A", "#4A4A4A", "#8C2332", "#4C9A4C"],
};

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. Throws on malformed hex — silence here prints garbage. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex color: "${hex}"`);
  const n = parseInt(m[1] as string, 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Minimum ratio an ink must clear against the reference garment.
 *
 * 3.0 is WCAG's large-text bar. Shirt slogans are display sizes — hundreds of
 * pixels tall — so the large-text threshold is the honest one to hold them to;
 * demanding 4.5 would rule out the brand's gold on anything but black.
 */
export const MIN_INK_CONTRAST = 3;

/** Contrast against the single worst garment in the tone — the one that decides it. */
export function worstContrast(ink: string, tone: GarmentTone): number {
  return Math.min(...GARMENT_SWATCHES[tone].map((g) => contrastRatio(ink, g)));
}

export function inkIsLegible(
  ink: string,
  tone: GarmentTone,
  min = MIN_INK_CONTRAST
): boolean {
  return worstContrast(ink, tone) >= min;
}

/**
 * Best ink for a garment tone out of the allowed palette. Prefers `preferred` when
 * it already clears the bar, so the director's aesthetic choice is only overridden
 * when it would actually be unreadable; otherwise takes whichever palette color
 * survives the worst garment best.
 */
export function pickContrastingInk(
  palette: string[],
  tone: GarmentTone,
  preferred?: string,
  min = MIN_INK_CONTRAST
): string {
  if (!palette.length) throw new Error("Empty ink palette");
  if (preferred && inkIsLegible(preferred, tone, min)) return preferred;

  return palette.reduce((best, c) =>
    worstContrast(c, tone) > worstContrast(best, tone) ? c : best
  );
}
