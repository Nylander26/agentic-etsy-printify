import { generateJSON } from "../lib/gemini.js";
import type { DesignMetadata, ProductType } from "../generator/types.js";

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

export const MAX_TITLE_CHARS = 140;
export const MAX_TAG_CHARS = 20;
export const TAG_COUNT = 13;

/**
 * Etsy accepts only letters, numbers, spaces, hyphens and apostrophes in a tag.
 * Anything else (commas above all — Etsy reads them as tag separators) makes Etsy
 * reject the tag, and a rejected tag can fail the listing update as a whole. Gemini
 * writes natural prose, so "dad's day, funny" arrives regularly; it used to go
 * straight through untouched.
 *
 * Returns "" for a tag with nothing usable left, so the caller can drop it.
 */
export function sanitizeTag(raw: string): string {
  const clean = raw
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= MAX_TAG_CHARS) return clean;

  // Drop whole words rather than slicing at 20. A hard slice shipped "Pregnant
  // Announcemen", "Minimalist Baby Ann" and "Halloween Baby Revea" to the store — nobody
  // searches a half-word, so those tags matched nothing at all. "Pregnant" alone is a
  // weaker tag but a real one.
  const words = clean.split(" ");
  const kept: string[] = [];
  for (const w of words) {
    const next = kept.length ? `${kept.join(" ")} ${w}` : w;
    if (next.length > MAX_TAG_CHARS) break;
    kept.push(w);
  }
  // A single first word longer than the limit leaves nothing to keep; cut it and accept it.
  return kept.length ? kept.join(" ") : clean.slice(0, MAX_TAG_CHARS).trim();
}

/** Cut to `max` chars on a word boundary — a hard slice leaves half-words in the title. */
export function trimToWord(s: string, max: number): string {
  const clean = s.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** A Gemini SEO payload is only usable if the fields Etsy requires are really there. */
function isUsableSEO(raw: Partial<EtsySEO> | null | undefined): raw is EtsySEO {
  return (
    !!raw &&
    typeof raw.title === "string" &&
    raw.title.trim().length > 0 &&
    typeof raw.description === "string" &&
    raw.description.trim().length > 0
  );
}

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
- Tags: exactly 13 tags, each max 20 chars, use long-tail keywords, no duplicates. Letters, numbers, spaces, hyphens and apostrophes ONLY — Etsy rejects a tag containing a comma or any other punctuation. Derive tags from the actual subject matter in the design brief, the niche/research keywords, AND the high-frequency competitor keywords above — but only include a competitor term when it genuinely matches this design (no keyword stuffing of irrelevant terms).
- taxonomyId: use ${TAXONOMY_IDS[meta.product]}

Respond ONLY with valid JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["tag1", "tag2", ..., "tag13"],
  "taxonomyId": ${TAXONOMY_IDS[meta.product]}
}
`.trim();

/**
 * Padding pool. Sized so the generic terms alone can fill all 13 slots — the fallback
 * must never come up short and never repeat, whatever the niche looks like.
 */
const PRODUCT_FILLERS: Record<ProductType, string[]> = {
  tshirt: ["graphic tee", "funny tshirt", "novelty shirt", "trendy tee", "unisex tee"],
  mug: ["coffee mug", "novelty mug", "ceramic mug", "funny mug", "cute mug"],
  poster: ["wall art", "art print", "home decor", "wall decor", "poster print"],
};

const UNIVERSAL_FILLERS = [
  "gift idea",
  "unique gift",
  "gift for him",
  "gift for her",
  "birthday gift",
  "made to order",
  "print on demand",
  "custom gift",
];

/**
 * Exactly TAG_COUNT sanitized, case-insensitively unique tags.
 *
 * Both the Gemini path and the fallback go through here. The fallback used to top up
 * with `while (tags.length < 13) tags.push(productName)`, which pushed the SAME tag
 * repeatedly — Etsy rejects duplicate tags, so a short Gemini reply could poison the
 * whole listing. Padding now stays unique by construction and, if it ever ran out of
 * material, returns short rather than looping.
 */
export function buildTags(
  preferred: string[],
  meta: Pick<DesignMetadata, "niche" | "product">,
  competitorKeywords: string[] = []
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  const push = (raw: string): void => {
    if (tags.length >= TAG_COUNT) return;
    const t = sanitizeTag(raw);
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    tags.push(t);
  };

  for (const t of preferred) push(t);
  // Mined competitor terms are proven buyer searches — better padding than generic filler.
  for (const t of competitorKeywords) push(t);

  // Composites only when they survive the 20-char cap intact. "funny halloween shirt gift"
  // and "... lover" both truncate to "funny halloween shir", collide, and cost two slots
  // to produce one meaningless tag.
  const fits = (s: string) => (s.length <= MAX_TAG_CHARS ? s : "");
  for (const t of [
    ...meta.niche.split(" "),
    fits(`${meta.niche} gift`),
    fits(`${meta.niche} lover`),
    ...PRODUCT_FILLERS[meta.product],
    ...UNIVERSAL_FILLERS,
  ]) push(t);

  return tags;
}

function fallbackSEO(meta: DesignMetadata, price: number, competitorKeywords: string[] = []): EtsySEO {
  const productName = meta.product === "tshirt" ? "T-Shirt" : meta.product === "mug" ? "Mug" : "Poster";
  const niche = meta.niche.replace(/\b\w/g, (c) => c.toUpperCase());
  const title = trimToWord(`${niche} ${productName} - ${meta.concept}`, MAX_TITLE_CHARS);

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

  const tags = buildTags(seedTags, meta, competitorKeywords);

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

  let raw: Partial<EtsySEO> | null = null;
  try {
    raw = await generateJSON<Partial<EtsySEO>>(
      SEO_PROMPT(meta, nicheKeywords, competitorKeywords, avgNichePrice, price)
    );
  } catch (err) {
    console.warn(
      `      ⚠ SEO Gemini failed (${err instanceof Error ? err.message : err}) — using fallback`
    );
    return fallbackSEO(meta, price, competitorKeywords);
  }

  // A reply that parsed as JSON can still be missing `title` or `description`. Reading
  // them unchecked threw a TypeError OUTSIDE the try above, so a malformed reply killed
  // the publish of that design instead of falling back — and an undefined description
  // would have reached Printify.
  if (!isUsableSEO(raw)) {
    console.warn(`      ⚠ SEO reply missing title/description — using fallback`);
    return fallbackSEO(meta, price, competitorKeywords);
  }

  const tags = buildTags(
    Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    meta,
    competitorKeywords
  );

  return {
    title: trimToWord(raw.title, MAX_TITLE_CHARS),
    description: raw.description,
    tags,
    taxonomyId: TAXONOMY_IDS[meta.product],
  };
}
