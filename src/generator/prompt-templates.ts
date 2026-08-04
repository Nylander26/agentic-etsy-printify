import { generateText } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import type { ProductType, VariationKind } from "./types.js";

/**
 * The brand's look comes from config, not from strings hardcoded here.
 *
 * These templates used to demand "warm pastels, vibrant retro hues" and ban the word
 * "minimalist", while the style guide asked for a dark, minimal, premium look — two
 * brands fighting inside one pipeline. `brand.aesthetic` and `brand.palette` are now
 * the only place that decision lives.
 */
function brandDirective(): string {
  const { aesthetic, palette } = getConfig().brand;
  return (
    `Brand aesthetic: ${aesthetic}. ` +
    `Draw from this palette: ${palette.join(", ")} — harmonize with it and use at most ` +
    `4 colors in the design.`
  );
}

// Base templates per product — decorative, commercial Etsy aesthetic
const BASE_TEMPLATES: Record<ProductType, string> = {
  tshirt:
    "A t-shirt graphic design on a pure white background. {concept}. {brand} " +
    "Confident illustration with expressive linework and purposeful accent details. " +
    "Centered composition, no mockup, no t-shirt shape, transparent-ready. " +
    "CRITICAL: the artwork must be a single self-contained graphic floating as a compact island on " +
    "plain white, with generous EMPTY MARGIN on all four sides. It must NOT bleed to the edges: no " +
    "full-canvas background fill, no edge-to-edge or repeating/tiled pattern, no background scenery, " +
    "flags, banners or borders that reach the canvas edges. Nothing is cut off by the frame. " +
    "Commercial Etsy bestseller aesthetic, lively and full of personality, print-ready DTG artwork.",

  mug:
    "A wrap-around mug design, seamless horizontal illustration full of character. {concept}. {brand} " +
    "Composition with accent elements repeated and balanced across the wrap. " +
    "White background, no perspective distortion. " +
    "Continuous pattern that tiles horizontally without seams. Aspect ratio suitable for mug wrap " +
    "(wide, short). Etsy gift-shop aesthetic, print-ready.",

  poster:
    "A high-resolution poster artwork. {concept}. {brand} " +
    "Composition with depth and layered detail, thematic motifs framing the focal subject. " +
    "Portrait orientation, professional visual hierarchy. Wall-art Etsy bestseller " +
    "aesthetic, print-ready fine art.",
};

// Variation modifiers applied on top of base
const VARIATION_MODIFIERS: Record<VariationKind, string> = {
  base:    "",
  dark:    "Dark color scheme on deep navy, black, or charcoal background with light/cream artwork. " +
           "Inverted palette but keep all decorative accents and lively character.",
  "no-text": "Illustration only, absolutely no text, no letters, no words anywhere in the image. " +
             "Compensate by adding extra decorative accents and visual interest.",
  minimal: "Stripped-back minimalist version: single-color line art, no decorative accents, " +
           "clean and modern. Use only when explicitly requested.",
};

function applyTemplate(
  product: ProductType,
  concept: string,
  variation: VariationKind
): string {
  const base = BASE_TEMPLATES[product]
    .replace("{concept}", concept)
    .replace("{brand}", brandDirective());
  const modifier = VARIATION_MODIFIERS[variation];
  return modifier ? `${base} ${modifier}` : base;
}

// Gemini Pro refines the raw concept into a detailed image-generation prompt
const OPTIMIZER_PROMPT = (
  concept: string,
  style: string,
  product: ProductType,
  basePrompt: string
) => `
You are an expert at writing prompts for AI image generation, specialized in commercial
print-on-demand (POD) designs that sell on Etsy.

Concept: "${concept}"
Style hint: "${style}"
Product: ${product}
Base prompt: "${basePrompt}"

Rewrite and improve this prompt for maximum image quality and commercial appeal,
WITHOUT changing the brand's look.

BRAND — this is not negotiable, keep every rewrite inside it:
${brandDirective()}

Rules:
- Keep it under 140 words
- Pick ONE concrete aesthetic that serves the brand above and commit to it. Match the
  style hint where it does not fight the brand; the brand wins any conflict.
- Name the concrete colors you are using, drawn from the brand palette.
- Include accent elements only where they earn their place — supporting the focal
  subject, never crowding it.
- Do not describe lettering, fonts or text treatment at all: the words are set
  separately in vector type downstream.
- For tshirts: always "SOLID PURE WHITE background (#FFFFFF) — NEVER a transparency
  checkerboard / grey-and-white grid pattern (an image generator cannot output real
  transparency; the backdrop must be flat opaque white), single self-contained centered
  graphic floating as a compact island with clear empty margin on all sides, NO full-bleed
  background, NO edge-to-edge or repeating pattern, NO background scenery/flags/borders
  reaching the edges, nothing cut off, no mockup, no garment". A t-shirt print is a
  contained graphic on white, NOT a mug wrap or a full-bleed poster.
- For mugs: always "seamless horizontal wrap-around, white background, no distortion"
- For posters: always "portrait orientation, fine art print, decorative border or framing motifs"
- AVOID: ${getConfig().brand.avoid.join(", ")}.
- Output ONLY the improved prompt, no explanation.
`.trim();

// Back-of-shirt design: a SMALL, simple complementary mark — not a second full illustration.
// Sits on the upper back; must read at a glance and stay visually consistent with the front.
const BACK_TEMPLATE =
  "A small, simple complementary back-of-shirt graphic on a pure white background. {concept}. {brand} " +
  "Compact emblem, badge, or minimal logo mark — NOT a large or detailed scene. " +
  "Keep it to a single focal element with at most a couple of accent marks. " +
  "Centered, small footprint suitable for " +
  "an upper-back placement, with clear empty margin on all sides — no full-bleed background, no " +
  "edge-to-edge pattern, nothing cut off by the frame. Transparent-ready, no mockup, no garment, " +
  "print-ready DTG artwork.";

export async function buildBackPrompt(
  concept: string,
  style: string,
  variation: VariationKind,
  optimize = true
): Promise<string> {
  const base = BACK_TEMPLATE.replace("{concept}", concept).replace("{brand}", brandDirective());
  const modifier = variation === "dark" ? ` ${VARIATION_MODIFIERS.dark}` : "";
  const withMod = `${base}${modifier}`;
  if (!optimize) return withMod;
  try {
    const optimized = await generateText(OPTIMIZER_PROMPT(concept, style, "tshirt", withMod));
    return optimized.trim();
  } catch {
    return withMod;
  }
}

/**
 * Appended when the words will be composited afterwards from a real font
 * (see generator/typography.ts). Two jobs: stop the model drawing letterforms it
 * would only garble, and keep the lower band clear so the type has somewhere to
 * land. The reserved band must track `generation.typography.box_top`.
 */
const ART_ONLY_SUFFIX =
  "CRITICAL — NO TEXT: the image must contain absolutely no letters, words, numbers, " +
  "captions, signatures or written characters of any kind. Illustration only. " +
  "COMPOSITION: place the entire illustration in the UPPER TWO THIRDS of the square " +
  "canvas. The BOTTOM THIRD must stay completely empty pure white — no artwork, no " +
  "accents, no shadows there — it is reserved for typography added later. " +
  "Compensate for the missing text with richer illustrative detail in the upper area.";

export function withArtOnly(prompt: string): string {
  return `${prompt} ${ART_ONLY_SUFFIX}`;
}

export async function buildPrompt(
  concept: string,
  style: string,
  product: ProductType,
  variation: VariationKind,
  optimize = true,
  artOnly = false
): Promise<string> {
  const base = applyTemplate(product, concept, variation);

  // Applied AFTER the optimizer so Gemini can't paraphrase the no-text constraint
  // away — it rewrites the prompt it is given, and it loves adding "bold lettering".
  if (!optimize) return artOnly ? withArtOnly(base) : base;

  try {
    const optimized = await generateText(
      OPTIMIZER_PROMPT(concept, style, product, base)
    );
    const result = optimized.trim();
    return artOnly ? withArtOnly(result) : result;
  } catch {
    // Fall back to template if Gemini fails
    return artOnly ? withArtOnly(base) : base;
  }
}
