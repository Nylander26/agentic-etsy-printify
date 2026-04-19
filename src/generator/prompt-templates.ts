import { generateText } from "../lib/gemini.js";
import type { ProductType, VariationKind } from "./types.js";

// Base templates per product — consistent quality baseline
const BASE_TEMPLATES: Record<ProductType, string> = {
  tshirt:
    "A minimalist t-shirt graphic design on a pure white background. {concept}. " +
    "Clean vector style, bold lines, suitable for screen printing or DTG. " +
    "Centered composition, no mockup, no t-shirt shape, transparent-ready. " +
    "High contrast, print-ready artwork.",

  mug:
    "A wrap-around mug design, seamless horizontal illustration. {concept}. " +
    "Vibrant colors, white background, no perspective distortion. " +
    "Print-ready, continuous pattern that tiles horizontally. " +
    "Aspect ratio suitable for mug wrap (wide, short).",

  poster:
    "A high-resolution poster artwork. {concept}. " +
    "Museum-quality composition, rich detail, suitable for wall art. " +
    "Portrait orientation, professional layout with visual hierarchy. " +
    "No text unless part of the concept. Print-ready.",
};

// Variation modifiers applied on top of base
const VARIATION_MODIFIERS: Record<VariationKind, string> = {
  base:    "",
  dark:    "Dark color scheme, deep navy/black/charcoal background with light artwork. Inverted palette.",
  "no-text": "Illustration only, absolutely no text, no letters, no words anywhere in the image.",
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
You are an expert at writing prompts for AI image generation, specialized in print-on-demand (POD) designs.

Concept: "${concept}"
Style hint: "${style}"
Product: ${product}
Base prompt: "${basePrompt}"

Rewrite and improve this prompt for maximum image quality and commercial appeal.
Rules:
- Keep it under 120 words
- Be specific about colors, composition, and visual elements
- Include style keywords (e.g. "flat design", "watercolor", "retro", "minimalist")
- For tshirts: always mention "transparent/white background, no mockup"
- For mugs: always mention "seamless wrap-around, white background"
- For posters: always mention "portrait orientation, fine art print"
- Output ONLY the improved prompt, no explanation.
`.trim();

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
