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
  competitorKeywords: string[],
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
- Research keywords: ${nicheKeywords.slice(0, 10).join(", ") || "(none)"}
- HIGH-FREQUENCY COMPETITOR KEYWORDS (mined from the top-ranked Etsy listings for this
  niche — these are proven buyer search terms; prioritize matching them in the title and
  tags WHERE they fit this specific design): ${competitorKeywords.slice(0, 15).join(", ") || "(none)"}
- Original design brief (what the artwork actually depicts — mine it for buyer search terms):
"""
${(meta.prompt ?? "").slice(0, 1200)}
"""

Write Etsy listing copy that maximizes search visibility and conversion.

Rules:
- Title: max 140 chars, start with the most important keyword, natural language
- Description: minimum 2000 chars, weave keywords naturally, include product details, gift ideas, care instructions. Use line breaks for readability. No markdown headers.
- Tags: exactly 13 tags, each max 20 chars, use long-tail keywords, no duplicates. Derive tags from the actual subject matter in the design brief, the niche/research keywords, AND the high-frequency competitor keywords above — but only include a competitor term when it genuinely matches this design (no keyword stuffing of irrelevant terms).
- taxonomyId: use ${TAXONOMY_IDS[meta.product]}

Respond ONLY with valid JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["tag1", "tag2", ..., "tag13"],
  "taxonomyId": ${TAXONOMY_IDS[meta.product]}
}
`.trim();

function fallbackSEO(meta: DesignMetadata, price: number, competitorKeywords: string[] = []): EtsySEO {
  const productName = meta.product === "tshirt" ? "T-Shirt" : meta.product === "mug" ? "Mug" : "Poster";
  const niche = meta.niche.replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `${niche} ${productName} - ${meta.concept}`.slice(0, 140);

  const seedTags = [
    niche,
    // Lead with mined competitor terms — proven buyer searches, even in the fallback path.
    ...competitorKeywords.slice(0, 5),
    productName,
    meta.concept.split(" ").slice(0, 3).join(" "),
    `${niche} gift`,
    `${niche} lover`,
    "gift idea",
    meta.style.split(",")[0]?.trim() ?? "decorative",
    "print on demand",
    `${niche} fan`,
    "unique gift",
  ];

  // De-dup (case-insensitive), enforce length, fill to 13.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of seedTags) {
    const t = raw.slice(0, 20).trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); tags.push(t); }
    if (tags.length >= 13) break;
  }
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

export interface SEOInput {
  /** Niche research keywords (e.g. seoKeywords / topTags). */
  nicheKeywords?: string[];
  /** High-frequency keywords mined from top-ranked competitor titles (R5). */
  competitorKeywords?: string[];
  avgNichePrice?: number;
  price?: number;
}

export async function generateSEO(
  meta: DesignMetadata,
  input: SEOInput = {}
): Promise<EtsySEO> {
  const {
    nicheKeywords = [],
    competitorKeywords = [],
    avgNichePrice = 25,
    price = 24.99,
  } = input;

  let raw: EtsySEO;
  try {
    raw = await generateJSON<EtsySEO>(
      SEO_PROMPT(meta, nicheKeywords, competitorKeywords, avgNichePrice, price)
    );
  } catch (err) {
    console.warn(
      `      ⚠ SEO Gemini failed (${err instanceof Error ? err.message : err}) — using fallback`
    );
    return fallbackSEO(meta, price, competitorKeywords);
  }

  // Enforce constraints — dedup case-insensitively, cap 20 chars, exactly 13.
  const title = raw.title.slice(0, 140);

  const seen = new Set<string>();
  const tags: string[] = [];
  const pushTag = (raw: string): void => {
    const t = raw.slice(0, 20).trim();
    if (t && !seen.has(t.toLowerCase()) && tags.length < 13) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  };

  for (const t of raw.tags ?? []) pushTag(t);
  // Fill any shortfall with mined competitor terms first (proven searches), then niche words.
  for (const t of competitorKeywords) if (tags.length < 13) pushTag(t);
  const fillers = [...meta.niche.split(" "), "gift idea", "print on demand", meta.product];
  for (let i = 0; tags.length < 13; i++) pushTag(fillers[i] ?? `${meta.product} ${i}`);

  return {
    title,
    description: raw.description,
    tags,
    taxonomyId: TAXONOMY_IDS[meta.product],
  };
}
