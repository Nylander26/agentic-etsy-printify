import { generateText } from "../lib/gemini.js";
import type { ProductType, VariationKind } from "./types.js";

// Base templates per product — decorative, commercial Etsy aesthetic
const BASE_TEMPLATES: Record<ProductType, string> = {
  tshirt:
    "A decorative t-shirt graphic design on a pure white background. {concept}. " +
    "Charming hand-drawn illustration with playful character, expressive linework, " +
    "and small accent details (hearts, stars, paw prints, dots, sparkles, or florals where fitting). " +
    "Curated color palette with 3-5 harmonious tones — warm pastels, dusty earth tones, " +
    "or vibrant retro hues (avoid flat monochrome). Bold script or display lettering when text is present, " +
    "paired with doodle accents. Centered composition, no mockup, no t-shirt shape, transparent-ready. " +
    "Commercial Etsy bestseller aesthetic, lively and full of personality, print-ready DTG artwork.",

  mug:
    "A wrap-around mug design, seamless horizontal illustration full of character. {concept}. " +
    "Decorative composition with multiple accent elements (florals, doodles, dots, stars, hearts, " +
    "or themed motifs) repeated and balanced across the wrap. Vibrant curated palette (3-5 tones), " +
    "white background, no perspective distortion. Hand-drawn or vector charm. " +
    "Continuous pattern that tiles horizontally without seams. Aspect ratio suitable for mug wrap " +
    "(wide, short). Etsy gift-shop aesthetic, print-ready.",

  poster:
    "A high-resolution decorative poster artwork. {concept}. " +
    "Rich composition with depth and layered detail — botanical accents, decorative borders, " +
    "or thematic motifs framing the focal subject. Curated harmonious palette (warm earthy tones, " +
    "boho terracotta, or soft pastels). Portrait orientation, professional visual hierarchy. " +
    "Hand-illustrated character (not flat-vector sterile). Wall-art Etsy bestseller aesthetic, " +
    "print-ready fine art.",
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
  const base = BASE_TEMPLATES[product].replace("{concept}", concept);
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

Rewrite and improve this prompt for maximum image quality and commercial appeal.
The goal: create lively, decorative designs that look like Etsy bestsellers — NOT flat
minimalist clip-art. Think hand-drawn charm, layered accents, curated color palettes.

Rules:
- Keep it under 140 words
- Pick ONE concrete aesthetic and commit to it. Choose from: retro-groovy 70s, boho line-art,
  cottagecore floral, hand-drawn doodle, vintage Americana, watercolor splash, paint-textured
  illustration, cute kawaii, retro varsity, or script-with-dingbats. Match the style hint.
- Specify a concrete 3-5 color palette by name (e.g. "mustard yellow, sage green, terracotta,
  cream"). Avoid bland palettes — pick palettes Etsy buyers love (warm earth tones, dusty
  pastels, retro brights, moody jewel tones).
- Always include decorative accent elements: small hearts, stars, dots, paw prints, florals,
  leaves, sparkles, dingbats, swooshes — at least 2 types repeated naturally.
- When text is present, specify the font character (e.g. "thick retro varsity serif",
  "loose cursive script", "chunky bold sans") and pair with accent doodles.
- For tshirts: always "transparent/white background, centered composition, no mockup, no garment"
- For mugs: always "seamless horizontal wrap-around, white background, no distortion"
- For posters: always "portrait orientation, fine art print, decorative border or framing motifs"
- AVOID these words: minimalist, simple, clean, plain, basic, flat-only, sterile.
- Output ONLY the improved prompt, no explanation.
`.trim();

// Back-of-shirt design: a SMALL, simple complementary mark — not a second full illustration.
// Sits on the upper back; must read at a glance and stay visually consistent with the front.
const BACK_TEMPLATE =
  "A small, simple complementary back-of-shirt graphic on a pure white background. {concept}. " +
  "Compact emblem, badge, short tagline, or minimal logo mark — NOT a large or detailed scene. " +
  "Keep it to a single focal element with at most a couple of accent doodles. " +
  "Use a color palette consistent with the front design. Centered, small footprint suitable for " +
  "an upper-back placement, transparent-ready, no mockup, no garment, print-ready DTG artwork.";

export async function buildBackPrompt(
  concept: string,
  style: string,
  variation: VariationKind,
  optimize = true
): Promise<string> {
  const base = BACK_TEMPLATE.replace("{concept}", concept);
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

export async function buildPrompt(
  concept: string,
  style: string,
  product: ProductType,
  variation: VariationKind,
  optimize = true
): Promise<string> {
  const base = applyTemplate(product, concept, variation);

  if (!optimize) return base;

  try {
    const optimized = await generateText(
      OPTIMIZER_PROMPT(concept, style, product, base)
    );
    return optimized.trim();
  } catch {
    // Fall back to template if Gemini fails
    return base;
  }
}
