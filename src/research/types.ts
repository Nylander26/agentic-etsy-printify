export interface NicheData {
  keyword: string;
  geo: string;
  avgInterest: number;       // 0–100 (Google Trends scale)
  peakInterest: number;      // 0–100
  trend: "rising" | "stable" | "declining";
  topQueries: string[];      // related top searches
  risingQueries: string[];   // related rising searches
  relatedTopics: string[];
  samplePoints: number;      // weeks of timeline data
}

export interface DesignIdea {
  concept: string;
  style: string;
  targetProduct: "tshirt" | "mug" | "poster";
}

export interface NicheAnalysis {
  keyword: string;
  demandScore: number;       // 1–10
  competitionScore: number;  // 1–10 (estimated by Gemini, since we lack direct data)
  avgPrice: number;          // estimated typical POD price for this niche (USD)
  estimatedMonthlySales: number;
  subNiches: string[];
  designIdeas: DesignIdea[];
  seoKeywords: string[];
  score: number;
}

export interface ResearchResult {
  date: string;
  seeds: string[];
  topNiches: NicheAnalysis[];
}
