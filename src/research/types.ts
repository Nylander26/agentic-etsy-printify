export interface PinterestSignals {
  source: "apify" | "none";
  sampledPins: number;
  promotedRatio: number | null;   // fraction of promoted (paid) pins (0-1); high = brands spend here
  medianFollowers: number | null; // median creator follower count; proxy for brand authority in niche
  titles: string[];               // top pin titles for prompt context
  trendScore: number;             // 0-10 composite (commercial * 0.6 + authority * 0.4); 0 = no data
}

export interface NicheData {
  keyword: string;
  geo: string;
  marketplace: MarketplaceSignals; // Etsy marketplace stats (via Apify scraper-as-a-service)
  pinterest: PinterestSignals;     // Pinterest engagement signal (optional — degrades gracefully)
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
  pinterestScore: number;        // 0-10 composite Pinterest trend
  pinterestAvailable: boolean;   // true = real Pinterest data; false = actor failed / no token (don't gate on it)
  score: number;
}

export interface ResearchResult {
  date: string;
  seeds: string[];
  topNiches: NicheAnalysis[];
}
