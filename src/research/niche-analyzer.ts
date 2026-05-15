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

const ANALYSIS_PROMPT = (data: NicheData) => `
You are an Etsy POD (print-on-demand) market analyst. Analyze this niche using Google Trends data plus your knowledge of the Etsy POD market.

Niche keyword: "${data.keyword}" (region: ${data.geo})

Google Trends signals (last 12 months, weekly samples=${data.samplePoints}):
- Average interest (0-100 scale): ${data.avgInterest.toFixed(1)}
- Peak interest: ${data.peakInterest}
- Trajectory: ${data.trend}

Top related searches: ${data.topQueries.join(", ") || "(none)"}

Rising related searches (gaining traction): ${data.risingQueries.join(", ") || "(none)"}

Related topics: ${data.relatedTopics.join(", ") || "(none)"}

Using these signals AND your training knowledge of the Etsy POD landscape (typical price ranges, saturation, audiences), respond ONLY with valid JSON:
{
  "demandScore": <1-10, weigh avgInterest and rising trajectory>,
  "competitionScore": <1-10, estimate Etsy saturation from your knowledge; higher = more saturated>,
  "avgPrice": <typical POD price in USD for items in this niche>,
  "estimatedMonthlySales": <realistic monthly sales for a new Etsy shop entering>,
  "subNiches": [<3-5 specific sub-niches with less competition>],
  "designIdeas": [
    { "concept": "<specific design idea>", "style": "<visual style>", "targetProduct": "tshirt" | "mug" | "poster" }
  ],
  "seoKeywords": [<8-12 long-tail keywords, max 20 chars each, Etsy-friendly>]
}

Design ideas must be concrete (e.g. "Cat wearing sunglasses with 'Cat Dad' text", not "funny cat design"). Include >=3 ideas mixing products.
`;

function computeScore(analysis: GeminiNicheResponse & { avgPrice: number }): number {
  const marginScore = Math.min(10, analysis.avgPrice / 5);
  const raw = (analysis.demandScore * 2 + marginScore) / analysis.competitionScore;
  return isFinite(raw) ? raw : 0;
}

export async function analyzeNiche(data: NicheData): Promise<NicheAnalysis> {
  const raw = await generateJSON<GeminiNicheResponse>(ANALYSIS_PROMPT(data));

  const demandScore = Math.max(1, Math.min(10, Number(raw.demandScore) || 5));
  const competitionScore = Math.max(1, Math.min(10, Number(raw.competitionScore) || 5));
  const avgPrice = parseFloat(String(raw.avgPrice ?? "20").replace(/[^0-9.]/g, "")) || 20;

  return {
    keyword: data.keyword,
    demandScore,
    competitionScore,
    avgPrice,
    estimatedMonthlySales: raw.estimatedMonthlySales ?? 0,
    subNiches: raw.subNiches ?? [],
    designIdeas: raw.designIdeas ?? [],
    seoKeywords: raw.seoKeywords ?? [],
    score: computeScore({ ...raw, demandScore, competitionScore, avgPrice }),
  };
}

export function rankNiches(analyses: NicheAnalysis[]): NicheAnalysis[] {
  return [...analyses].sort((a, b) => b.score - a.score);
}
