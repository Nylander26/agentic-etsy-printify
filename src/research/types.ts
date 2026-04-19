export interface RawListing {
  listing_id: number;
  title: string;
  description: string;
  price: { amount: number; divisor: number; currency_code: string };
  views: number;
  num_favorers: number;
  tags: string[];
  creation_tsz: number; // shop listing age proxy
  shop_id: number;
}

export interface NicheData {
  keyword: string;
  listings: RawListing[];
  avgPrice: number;
  avgFavorers: number;
  avgViews: number;
  totalListings: number;
}

export interface DesignIdea {
  concept: string;
  style: string;
  targetProduct: "tshirt" | "mug" | "poster";
}

export interface NicheAnalysis {
  keyword: string;
  demandScore: number;       // 1–10
  competitionScore: number;  // 1–10
  avgPrice: number;
  estimatedMonthlySales: number;
  subNiches: string[];
  designIdeas: DesignIdea[];
  seoKeywords: string[];
  score: number;             // ranking formula result
}

export interface ResearchResult {
  date: string;
  seeds: string[];
  topNiches: NicheAnalysis[];
}
