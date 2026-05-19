import { generateJSON } from "../lib/gemini.js";
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
  const marketplaceBlock = hasMarketplace
    ? `
Marketplace signals (source: ${m.source}, keyword "${data.keyword}"):
- Total Etsy listings: ${m.listingCount ?? "unknown"}
- Price range: ${m.minPrice !== null ? `$${m.minPrice.toFixed(2)} - $${m.maxPrice?.toFixed(2)}` : "unknown"}
- Avg price: ${m.avgPrice !== null ? `$${m.avgPrice.toFixed(2)}` : "unknown"}
- Est. monthly revenue per top listing: ${m.estMonthlyRevenue !== null ? `$${m.estMonthlyRevenue.toFixed(0)}` : "unknown"}
- Est. monthly sales per top listing: ${m.estMonthlySales ?? "unknown"}
- Top listings (${m.sampledListings} sampled):
${m.titles.slice(0, 8).map((t) => `  • ${t}`).join("\n") || "  (none)"}
- Popular tags: ${m.topTags.slice(0, 10).join(", ") || "(none)"}

Trust the marketplace data above as ground truth for demand visibility and pricing.`
    : `
Marketplace signals: NOT AVAILABLE (no APIFY_TOKEN configured).
Estimate competition and pricing from your training knowledge of the Etsy POD market.`;

  return `
You are an Etsy POD (print-on-demand) market analyst.

Niche keyword: "${data.keyword}" (region: ${data.geo})
${marketplaceBlock}

Respond ONLY with valid JSON:
{
  "demandScore": <1-10, weigh avgInterest + trajectory + marketplace revenue>,
  "competitionScore": <1-10, derive from listing count: <1k=2, <20k=5, <100k=7, <500k=8, >1M=10>,
  "avgPrice": <USD, prefer scraped avg if available, otherwise estimate>,
  "estimatedMonthlySales": <realistic monthly sales for a NEW shop entering this niche>,
  "subNiches": [<3-5 specific, less-saturated sub-niches>],
  "designIdeas": [
    { "concept": "<specific design idea>", "style": "<visual style>", "targetProduct": "tshirt" | "mug" | "poster" }
  ],
  "seoKeywords": [<8-12 long-tail keywords, max 20 chars each, Etsy-friendly>]
}

Design ideas must be concrete (e.g. "Cat wearing sunglasses with 'Cat Dad' text", not "funny cat design"). Include >=3 ideas mixing products.
`;
};

function computeScore(input: {
  demandScore: number;
  competitionScore: number;
  avgPrice: number;
}): number {
  const marginScore = Math.min(10, input.avgPrice / 5);
  const raw = (input.demandScore * 2 + marginScore) / input.competitionScore;
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

  return {
    keyword: data.keyword,
    demandScore,
    competitionScore,
    avgPrice,
    estimatedMonthlySales: m.estMonthlySales ?? raw.estimatedMonthlySales ?? 0,
    subNiches: raw.subNiches ?? [],
    designIdeas: raw.designIdeas ?? [],
    seoKeywords: raw.seoKeywords ?? [],
    marketplaceSource: m.source,
    listingCount: m.listingCount,
    estMonthlyRevenue: m.estMonthlyRevenue,
    score: computeScore({ demandScore, competitionScore, avgPrice }),
  };
}

export function rankNiches(analyses: NicheAnalysis[]): NicheAnalysis[] {
  return [...analyses].sort((a, b) => b.score - a.score);
}
