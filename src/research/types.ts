export interface NicheData {
  keyword: string;
  geo: string;
  marketplace: MarketplaceSignals; // Etsy marketplace stats (via Apify scraper-as-a-service)
}

export interface MarketplaceSignals {
  source: "apify" | "none";
  listingCount: number | null;        // total listings on Etsy for this keyword
  avgPrice: number | null;            // avg price across sampled listings (USD)
  minPrice: number | null;
  maxPrice: number | null;
  estMonthlyRevenue: number | null;   // avg monthly revenue per top listing (USD)
  estMonthlySales: number | null;     // DEPRECATED: actor exposes no sales/review counts — always null
  sampledListings: number;            // real depth signal: how many listings the term returns (full page = active term)
  avgRating: number | null;           // avg star rating across the sample (real field from actor)
  topRating: number | null;           // avg rating of the top-ranked listings (by Etsy `position` under most_relevant — weak but REAL demand proxy)
  titles: string[];                   // top listing titles for prompt context
  topTags: string[];                  // popular tags for SEO context
}

export interface DesignIdea {
  concept: string;
  style: string;
  targetProduct: "tshirt" | "mug" | "poster";
}

export interface NicheAnalysis {
  keyword: string;
  demandScore: number;       // 1–10
  competitionScore: number;  // 1–10 (from Etsy listing count when available)
  avgPrice: number;          // scraped avg or estimated typical POD price (USD)
  estimatedMonthlySales: number;
  subNiches: string[];
  designIdeas: DesignIdea[];
  seoKeywords: string[];
  marketplaceSource: "apify" | "none";
  listingCount: number | null;
  estMonthlyRevenue: number | null;
  score: number;
}

export interface ResearchResult {
  date: string;
  seeds: string[];
  topNiches: NicheAnalysis[];
}
