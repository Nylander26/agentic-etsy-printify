/**
 * EverBee marketplace data source.
 *
 * Status: EverBee's public developer API is "coming soon" (dev.everbee.io).
 * This client is structured so that once the API ships, only the
 * REQUEST and PARSE sections need updating.
 *
 * Expected EverBee features (based on their product UI):
 *   - Keyword search → total Etsy listings, avg price, avg revenue
 *   - Top sellers + their estimated monthly sales/revenue
 *   - Popular tags for the keyword
 *
 * Without EVERBEE_API_KEY set, returns an empty `none` signal and the
 * pipeline falls back to Google Trends + Gemini estimates only.
 */
import axios from "axios";
import { env } from "../lib/env.js";
import type { MarketplaceSignals } from "./types.js";

const BASE_URL = env.EVERBEE_API_BASE ?? "https://api.everbee.io/v1";
const KEY = env.EVERBEE_API_KEY;

const GAP_MS = 2000;
let lastCall = 0;
async function throttle(): Promise<void> {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

const EMPTY: MarketplaceSignals = {
  source: "none",
  listingCount: null,
  avgPrice: null,
  minPrice: null,
  maxPrice: null,
  estMonthlyRevenue: null,
  estMonthlySales: null,
  sampledListings: 0,
  titles: [],
  topTags: [],
};

// Tentative response shape — update when EverBee publishes the spec.
interface EverBeeListing {
  title?: string;
  price?: number;
  tags?: string[];
  est_monthly_sales?: number;
  est_monthly_revenue?: number;
}
interface EverBeeKeywordResponse {
  total_listings?: number;
  avg_price?: number;
  min_price?: number;
  max_price?: number;
  est_monthly_revenue?: number;
  est_monthly_sales?: number;
  listings?: EverBeeListing[];
  popular_tags?: string[];
}

export async function fetchMarketplaceSignals(keyword: string): Promise<MarketplaceSignals> {
  if (!KEY) {
    console.warn(`  ⚠️  EVERBEE_API_KEY not set — skipping marketplace signals for "${keyword}"`);
    return EMPTY;
  }

  await throttle();
  try {
    // REQUEST — adjust path/params once EverBee publishes spec
    const res = await axios.get<EverBeeKeywordResponse>(`${BASE_URL}/keywords/search`, {
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: "application/json",
      },
      params: { q: keyword, limit: 25 },
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });

    if (res.status !== 200) {
      console.warn(`  ⚠️  EverBee returned ${res.status} for "${keyword}"`);
      return EMPTY;
    }

    // PARSE — adjust field names once EverBee publishes spec
    const data = res.data;
    const listings = data.listings ?? [];
    const prices = listings
      .map((l) => l.price)
      .filter((p): p is number => typeof p === "number" && p > 0);

    return {
      source: "everbee",
      listingCount: data.total_listings ?? null,
      avgPrice:
        data.avg_price ??
        (prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null),
      minPrice: data.min_price ?? (prices.length ? Math.min(...prices) : null),
      maxPrice: data.max_price ?? (prices.length ? Math.max(...prices) : null),
      estMonthlyRevenue: data.est_monthly_revenue ?? null,
      estMonthlySales: data.est_monthly_sales ?? null,
      sampledListings: listings.length,
      titles: listings
        .map((l) => l.title)
        .filter((t): t is string => !!t)
        .slice(0, 10)
        .map((t) => t.slice(0, 120)),
      topTags: data.popular_tags ?? [],
    };
  } catch (err) {
    console.warn(
      `  ⚠️  EverBee fetch failed for "${keyword}": ${err instanceof Error ? err.message : err}`
    );
    return EMPTY;
  }
}

// Map raw listing count → competition score 1..10. Same heuristic regardless of source.
export function competitionFromListings(listingCount: number | null): number | null {
  if (listingCount === null) return null;
  if (listingCount < 1_000) return 2;
  if (listingCount < 5_000) return 3;
  if (listingCount < 20_000) return 5;
  if (listingCount < 100_000) return 7;
  if (listingCount < 500_000) return 8;
  if (listingCount < 1_500_000) return 9;
  return 10;
}
