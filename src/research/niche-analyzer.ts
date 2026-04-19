import { generateJSON } from "../lib/gemini.js";
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

const ANALYSIS_PROMPT = (keyword: string, data: NicheData) => `
You are an Etsy POD (print-on-demand) market analyst. Analyze this Etsy niche data.

Niche keyword: "${keyword}"
Total listings sampled: ${data.totalListings}
Average price (USD): $${data.avgPrice.toFixed(2)}
Average favorers: ${data.avgFavorers.toFixed(0)}
Average views: ${data.avgViews.toFixed(0)}

Sample listing titles (top 15):
${data.listings
  .slice(0, 15)
  .map((l, i) => `${i + 1}. "${l.title}" — $${(l.price.amount / l.price.divisor).toFixed(2)}, ${l.num_favorers} favs`)
  .join("\n")}

Sample tags from listings:
${[...new Set(data.listings.flatMap((l) => l.tags))].slice(0, 30).join(", ")}

Respond ONLY with valid JSON matching this exact schema:
{
  "demandScore": <1-10, based on favorers/views/competition>,
  "competitionScore": <1-10, higher = more saturated>,
  "avgPrice": <realistic average price in USD>,
  "estimatedMonthlySales": <estimated monthly sales for a new shop entering this niche>,
  "subNiches": [<3-5 specific sub-niches with less competition>],
  "designIdeas": [
    { "concept": "<specific design idea>", "style": "<visual style>", "targetProduct": "tshirt" | "mug" | "poster" }
  ],
  "seoKeywords": [<8-12 long-tail keywords, max 20 chars each, Etsy-friendly>]
}

Design ideas should be concrete and specific (e.g. "Cat wearing sunglasses with 'Cat Dad' text" not "funny cat design").
Include at least 3 design ideas, mix of products.
`;

function computeScore(analysis: GeminiNicheResponse, avgPrice: number): number {
  // Formula from plan: (demanda × 2 + margen) / competencia
  // margen = proxy based on price (higher price = higher margin potential)
  const marginScore = Math.min(10, avgPrice / 5);
  return (analysis.demandScore * 2 + marginScore) / analysis.competitionScore;
}

export async function analyzeNiche(data: NicheData): Promise<NicheAnalysis> {
  const raw = await generateJSON<GeminiNicheResponse>(
    ANALYSIS_PROMPT(data.keyword, data)
  );

  // Clamp scores to valid range
  const demandScore = Math.max(1, Math.min(10, raw.demandScore));
  const competitionScore = Math.max(1, Math.min(10, raw.competitionScore));

  return {
    keyword: data.keyword,
    demandScore,
    competitionScore,
    avgPrice: raw.avgPrice ?? data.avgPrice,
    estimatedMonthlySales: raw.estimatedMonthlySales ?? 0,
    subNiches: raw.subNiches ?? [],
    designIdeas: raw.designIdeas ?? [],
    seoKeywords: raw.seoKeywords ?? [],
    score: computeScore({ ...raw, demandScore, competitionScore }, data.avgPrice),
  };
}

export function rankNiches(analyses: NicheAnalysis[]): NicheAnalysis[] {
  return [...analyses].sort((a, b) => b.score - a.score);
}
