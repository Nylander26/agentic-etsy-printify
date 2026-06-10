/**
 * Competitor SEO mining (R5).
 *
 * The Etsy scraper already returns the top-ranked listing TITLES for each niche
 * (stored in `nicheContext.topTitles`) — data we already paid Apify for but barely
 * used. Etsy titles are keyword-stuffed by sellers who rank, so the terms that recur
 * across the best-ranked titles are exactly what buyers search for. We mine those
 * high-frequency uni-/bi-grams and feed them into the publisher's SEO generation so
 * our titles/tags match proven search demand.
 *
 * Pure + deterministic (no I/O) → cheap to unit-test.
 */

// Generic words that carry no niche signal (articles, prepositions, filler).
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "our", "this", "that", "from", "are",
  "not", "all", "any", "new", "set", "of", "to", "in", "on", "by", "or", "a", "an",
  "his", "her", "him", "she", "they", "them", "it", "is", "be", "as", "at", "we",
  "best", "great", "perfect", "cute", "cool", "custom", "personalized", "unique",
]);

// Product/material nouns — useful inside a bigram ("cat mug") but noise as a lone tag.
const PRODUCT_WORDS = new Set([
  "shirt", "shirts", "tshirt", "tshirts", "tee", "tees", "sweatshirt", "sweatshirts",
  "hoodie", "hoodies", "mug", "mugs", "cup", "cups", "poster", "posters", "print",
  "prints", "gift", "gifts", "tshirt", "apparel", "unisex", "men", "women", "womens",
  "mens", "kids",
]);

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * A bigram is noise when it leads with a product noun — these are almost always
 * title-boundary artifacts ("...Cat Mama Shirt, Cat Lover..." → "shirt cat"), not
 * real phrases. Trailing product nouns are fine ("cat shirt", "mom mug").
 */
function isNoiseBigram(a: string): boolean {
  return PRODUCT_WORDS.has(a);
}

/**
 * Mines high-frequency keywords from competitor titles, ranked by how many DISTINCT
 * titles each term appears in (per-title dedup so one keyword-stuffed listing can't
 * dominate). Bigrams (more specific, better Etsy tags) are prioritized over unigrams.
 * Only terms appearing in `minTitles`+ titles are kept — thin/garbage data yields [].
 */
export function mineCompetitorKeywords(
  titles: string[],
  max = 15,
  minTitles = 2
): string[] {
  const clean = titles.map((t) => t ?? "").filter((t) => t.trim().length > 0);
  if (clean.length < minTitles) return [];

  const uni = new Map<string, number>();
  const bi = new Map<string, number>();

  for (const title of clean) {
    const toks = tokenize(title);
    const seenU = new Set<string>();
    const seenB = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i] as string;
      if (!PRODUCT_WORDS.has(t) && !seenU.has(t)) {
        uni.set(t, (uni.get(t) ?? 0) + 1);
        seenU.add(t);
      }
      if (i + 1 < toks.length) {
        const a = toks[i] as string;
        const b = toks[i + 1] as string;
        if (isNoiseBigram(a)) continue;
        const big = `${a} ${b}`;
        if (!seenB.has(big)) {
          bi.set(big, (bi.get(big) ?? 0) + 1);
          seenB.add(big);
        }
      }
    }
  }

  const ranked = (m: Map<string, number>): string[] =>
    [...m.entries()]
      .filter(([, c]) => c >= minTitles)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([term]) => term);

  // Bigrams first (specific long-tail), then unigrams not already covered by a bigram.
  const bigrams = ranked(bi);
  const bigramWords = new Set(bigrams.flatMap((g) => g.split(" ")));
  const unigrams = ranked(uni).filter((u) => !bigramWords.has(u));

  const out: string[] = [];
  for (const term of [...bigrams, ...unigrams]) {
    if (!out.includes(term)) out.push(term);
    if (out.length >= max) break;
  }
  return out;
}
