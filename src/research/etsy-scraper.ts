import axios from "axios";
import { env } from "../lib/env.js";
import type { NicheData, RawListing } from "./types.js";

const BASE = "https://openapi.etsy.com/v3/application";

// Re-uses the Etsy token from the saved token file
import { readFileSync, existsSync } from "fs";

function getEtsyToken(): string {
  if (existsSync(".etsy-tokens.json")) {
    const tokens = JSON.parse(readFileSync(".etsy-tokens.json", "utf-8")) as {
      access_token: string;
    };
    return tokens.access_token;
  }
  throw new Error("No Etsy tokens. Run: pnpm tsx src/lib/etsy-auth.ts");
}

// Etsy rate limit: 10 req/sec — gap of 110ms between requests
const RATE_GAP_MS = 110;
let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const wait = RATE_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

interface EtsyListingResponse {
  listing_id: number;
  title: string;
  description: string;
  price: { amount: number; divisor: number; currency_code: string };
  views: number;
  num_favorers: number;
  tags: string[];
  creation_tsz: number;
  shop_id: number;
}

interface EtsySearchResponse {
  results: EtsyListingResponse[];
  count: number;
}

async function fetchListings(
  keyword: string,
  limit = 50
): Promise<EtsyListingResponse[]> {
  await rateLimit();

  const token = getEtsyToken();
  const res = await axios.get<EtsySearchResponse>(`${BASE}/listings/active`, {
    headers: {
      "x-api-key": env.ETSY_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    params: {
      keywords: keyword,
      limit,
      sort_on: "score",
      // Request extra fields
      fields: [
        "listing_id", "title", "description", "price",
        "views", "num_favorers", "tags", "creation_tsz", "shop_id",
      ].join(","),
    },
  });

  return res.data.results;
}

function priceInUSD(listing: EtsyListingResponse): number {
  return listing.price.amount / listing.price.divisor;
}

export async function searchNiche(keyword: string, limit = 50): Promise<NicheData> {
  const raw = await fetchListings(keyword, limit);

  if (raw.length === 0) {
    return {
      keyword,
      listings: [],
      avgPrice: 0,
      avgFavorers: 0,
      avgViews: 0,
      totalListings: 0,
    };
  }

  const prices = raw.map(priceInUSD);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const avgFavorers = raw.reduce((a, b) => a + b.num_favorers, 0) / raw.length;
  const avgViews = raw.reduce((a, b) => a + b.views, 0) / raw.length;

  // Map to internal type — omit raw description to save tokens when sending to Gemini
  const listings: RawListing[] = raw.map((l) => ({
    listing_id: l.listing_id,
    title: l.title,
    description: l.description.slice(0, 200), // truncate to save tokens
    price: l.price,
    views: l.views,
    num_favorers: l.num_favorers,
    tags: l.tags,
    creation_tsz: l.creation_tsz,
    shop_id: l.shop_id,
  }));

  return {
    keyword,
    listings,
    avgPrice,
    avgFavorers,
    avgViews,
    totalListings: raw.length,
  };
}
