import { generateJSON } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { competitionFromListings } from "./apify-source.js";
import type { NicheData, NicheAnalysis, DesignIdea } from "./types.js";

interface GeminiNicheResponse {
  demandScore: number;
  competitionScore: number;
  avgPrice: number;
  estimatedMonthlySales: number;
  subNiches: string[];
  designIdeas: DesignIdea[];
  seoKeywords: string[];
}

const ANALYSIS_PROMPT = (data: NicheData) => {
  const m = data.marketplace;
  const hasMarketplace = m.source !== "none";
  const allowedProducts = getConfig().generation.products;
  const productEnum = allowedProducts.map((p) => `"${p}"`).join(" | ");
  const marketplaceBlock = hasMarketplace
    ? `
REAL marketplace signals (source: ${m.source}, keyword "${data.keyword}" — live Etsy sample):
- Listings returned for this term: ${m.sampledListings}
- Price range: ${m.minPrice !== null ? `$${m.minPrice.toFixed(2)} - $${m.maxPrice?.toFixed(2)}` : "unknown"}
- Avg price: ${m.avgPrice !== null ? `$${m.avgPrice.toFixed(2)}` : "unknown"}
- Avg rating across sample: ${m.avgRating !== null ? `${m.avgRating.toFixed(2)}★` : "unknown"}
- Top-ranked listings rating (Etsy relevance order = weak proxy for what sells): ${m.topRating !== null ? `${m.topRating.toFixed(2)}★` : "unknown"}
- Top listings sampled:
${m.titles.slice(0, 8).map((t) => `  • ${t}`).join("\n") || "  (none)"}

HOW TO READ THE LISTING COUNT — this is the part that is easy to get backwards.
Listing depth measures COMPETITION, not demand. We deliberately search long-tail phrases,
so a smaller result set is the expected shape of a good niche: it means few sellers, which
is exactly what a store with no ranking authority needs. Do NOT mark a specific phrase down
for returning fewer listings than a broad category term would.

- demandScore answers: is there a real, sizeable group of people who would search THIS phrase
  and buy? Judge it from the size of the buyer identity the phrase names, plus the evidence
  that money moves here — sellers bothered to list, the prices asked are real retail prices,
  the titles read like commercial products rather than filler.
- competitionScore answers: how crowded and how generic is what came back?
- A genuinely EMPTY result set (0-2 listings, no prices) is different: that is either a dead
  phrase or one nobody searches. Score demand low there, and only there.

IMPORTANT — the scraper exposes NO sales count and NO review count for this niche.
Do NOT invent or estimate sales figures from prior knowledge.`
    : `
Marketplace signals: NOT COLLECTED for this run.

This is not a gap to compensate for. The keyword was already measured against real Etsy
search volume and competition before it reached you, and it passed — that decision is made.
Your job here is the creative half, and it is the half that actually gets used downstream:

- designIdeas is the important output. Spend your effort there.
- demandScore / competitionScore: return 5. They are not read when there is no sample, and
  a confident-looking number invented from priors is worse than an honest placeholder.
- avgPrice: a reasonable US Etsy estimate for this product is fine.`;

  return `
You are an Etsy POD (print-on-demand) market analyst.

Niche keyword: "${data.keyword}" (region: ${data.geo})
${marketplaceBlock}

Respond ONLY with valid JSON:
{
  "demandScore": <1-10, size of the buyer group for THIS phrase + evidence money moves here. Never a training prior about sales volume, and never penalized for the phrase being specific>,
  "competitionScore": <1-10, how crowded/generic the returned listings look — THIS is where listing depth belongs>,
  "avgPrice": <USD, prefer scraped avg if available, otherwise estimate>,
  "estimatedMonthlySales": <leave as 0 — no real sales data is available; do not guess>,
  "subNiches": [<3-5 specific, less-saturated sub-niches>],
  "designIdeas": [
    { "concept": "<specific design idea>", "style": "<visual style>", "targetProduct": ${productEnum} }
  ],
  "seoKeywords": [<8-12 long-tail keywords, max 20 chars each, Etsy-friendly>]
}

Generate AT LEAST 5 concrete design ideas, ALL with targetProduct in [${productEnum}].
Ideas must be specific (e.g. "Dad in sunglasses grilling with 'Grillfather' text", not "funny dad design").
`;
};

// pinterestScore is 0 when Pinterest is unavailable — formula degrades to original.
// Weight 0.5: strong Pinterest (10) adds +5 to numerator, meaningful but not dominant.
function computeScore(input: {
  demandScore: number;
  competitionScore: number;
  avgPrice: number;
  pinterestScore: number;
}): number {
  const marginScore = Math.min(10, input.avgPrice / 5);
  const pinterestBoost = input.pinterestScore * 0.5;
  const raw = (input.demandScore * 2 + marginScore + pinterestBoost) / input.competitionScore;
  return isFinite(raw) ? raw : 0;
}

export async function analyzeNiche(data: NicheData): Promise<NicheAnalysis> {
  const raw = await generateJSON<GeminiNicheResponse>(ANALYSIS_PROMPT(data));
  const m = data.marketplace;

  const demandScore = Math.max(1, Math.min(10, Number(raw.demandScore) || 5));

  const realCompetition = competitionFromListings(m.listingCount);
  const competitionScore =
    realCompetition ?? Math.max(1, Math.min(10, Number(raw.competitionScore) || 5));

  const geminiPrice =
    parseFloat(String(raw.avgPrice ?? "20").replace(/[^0-9.]/g, "")) || 20;
  const avgPrice = m.avgPrice ?? geminiPrice;

  const pinterestScore = data.pinterest.trendScore;
  const pinterestAvailable = data.pinterest.source === "apify";

  return {
    keyword: data.keyword,
    demandScore,
    competitionScore,
    avgPrice,
    estimatedMonthlySales: 0, // no real sales/review data from the scraper — never fabricated

    subNiches: raw.subNiches ?? [],
    designIdeas: raw.designIdeas ?? [],
    seoKeywords: raw.seoKeywords ?? [],
    marketplaceSource: m.source,
    listingCount: m.listingCount,
    estMonthlyRevenue: m.estMonthlyRevenue,
    pinterestScore,
    pinterestAvailable,
    score: computeScore({ demandScore, competitionScore, avgPrice, pinterestScore }),
  };
}

export function rankNiches(analyses: NicheAnalysis[]): NicheAnalysis[] {
  return [...analyses].sort((a, b) => b.score - a.score);
}
