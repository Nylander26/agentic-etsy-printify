import { generateJSON } from "../lib/gemini.js";
import type { DesignMetadata } from "../generator/types.js";

export interface EtsySEO {
  title: string;         // max 140 chars, keyword-first
  description: string;  // 2000+ chars, natural keyword integration
  tags: string[];       // exactly 13, max 20 chars each
  taxonomyId: number;   // Etsy category ID
}

// Common Etsy taxonomy IDs for POD products
const TAXONOMY_IDS = {
  tshirt: 212,   // Clothing > Shirts & Tops > T-Shirts
  mug: 1709,     // Home & Living > Kitchen & Dining > Mugs
  poster: 1242,  // Art & Collectibles > Prints > Digital Prints
} as const;

const SEO_PROMPT = (
  meta: DesignMetadata,
  nicheKeywords: string[],
  avgNichePrice: number,
  price: number
) => `
You are an expert Etsy SEO copywriter specializing in print-on-demand products.

Design details:
- Niche: "${meta.niche}"
- Concept: "${meta.concept}"
- Style: "${meta.style}"
- Product: ${meta.product}
- Price: $${price.toFixed(2)}
- Competitor avg price: $${avgNichePrice.toFixed(2)}
- Research keywords: ${nicheKeywords.slice(0, 10).join(", ")}

Write Etsy listing copy that maximizes search visibility and conversion.

Rules:
- Title: max 140 chars, start with the most important keyword, natural language
- Description: minimum 2000 chars, weave keywords naturally, include product details, gift ideas, care instructions. Use line breaks for readability. No markdown headers.
- Tags: exactly 13 tags, each max 20 chars, use long-tail keywords, no duplicates
- taxonomyId: use ${TAXONOMY_IDS[meta.product]}

Respond ONLY with valid JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["tag1", "tag2", ..., "tag13"],
  "taxonomyId": ${TAXONOMY_IDS[meta.product]}
}
`.trim();

function fallbackSEO(meta: DesignMetadata, price: number): EtsySEO {
  const productName = meta.product === "tshirt" ? "T-Shirt" : meta.product === "mug" ? "Mug" : "Poster";
  const niche = meta.niche.replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `${niche} ${productName} - ${meta.concept}`.slice(0, 140);

  const seedTags = [
    niche,
    productName,
    meta.concept.split(" ").slice(0, 3).join(" "),
    `${niche} gift`,
    `${niche} lover`,
    "etsy bestseller",
    "gift idea",
    productName.toLowerCase(),
    meta.style.split(",")[0]?.trim() ?? "decorative",
    "print on demand",
    "custom design",
    `${niche} fan`,
    "unique gift",
  ];

  const tags = seedTags.map((t) => t.slice(0, 20).trim()).filter(Boolean).slice(0, 13);
  while (tags.length < 13) tags.push(productName.toLowerCase());

  const description =
    `${title}\n\n` +
    `A ${meta.style} ${productName.toLowerCase()} featuring ${meta.concept}. ` +
    `Perfect gift for ${niche} lovers. High-quality print-on-demand product, ` +
    `made-to-order with premium materials. Priced at $${price.toFixed(2)}.\n\n` +
    `Care: machine wash cold inside out for best print longevity (apparel) or ` +
    `dishwasher-safe (mugs). Each piece is printed and shipped within 3-7 business days.`;

  return {
    title,
    description,
    tags,
    taxonomyId: TAXONOMY_IDS[meta.product],
  };
}

export async function generateSEO(
  meta: DesignMetadata,
  nicheKeywords: string[] = [],
  avgNichePrice = 25,
  price = 24.99
): Promise<EtsySEO> {
  let raw: EtsySEO;
  try {
    raw = await generateJSON<EtsySEO>(
      SEO_PROMPT(meta, nicheKeywords, avgNichePrice, price)
    );
  } catch (err) {
    console.warn(
      `      ⚠ SEO Gemini failed (${err instanceof Error ? err.message : err}) — using fallback`
    );
    return fallbackSEO(meta, price);
  }

  // Enforce constraints
  const title = raw.title.slice(0, 140);

  const tags = raw.tags
    .map((t) => t.slice(0, 20).trim())
    .filter((t) => t.length > 0)
    .slice(0, 13);

  // Pad to 13 if Gemini returned fewer
  while (tags.length < 13) {
    tags.push(meta.niche.split(" ")[tags.length % 3] ?? meta.product);
  }

  return {
    title,
    description: raw.description,
    tags,
    taxonomyId: TAXONOMY_IDS[meta.product],
  };
}
