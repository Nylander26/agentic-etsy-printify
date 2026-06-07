/**
 * Apify Etsy marketplace data source.
 *
 * Calls a public Etsy search scraper actor on Apify (default:
 * `automation-lab/etsy-scraper`) and aggregates the sampled results into the
 * shared `MarketplaceSignals` shape used by the niche analyzer.
 *
 * The actor returns ~50 listing samples (name, price, currency, rating, shop)
 * but DOES NOT expose the total Etsy listing count. We treat the sample as the
 * source of truth: prices/titles/ratings feed Gemini for qualitative
 * competition analysis; the absolute saturation count is intentionally null.
 *
 * Without APIFY_TOKEN set, returns an empty `none` signal and the pipeline
 * falls back to Gemini priors only.
 */
import axios from "axios";
import https from "node:https";
import { env } from "../lib/env.js";
import { getConfig } from "../lib/config.js";
import { readApifyCache, writeApifyCache } from "../lib/apify-cache.js";
import type { MarketplaceSignals } from "./types.js";

const BASE_URL = "https://api.apify.com/v2";
const DEFAULT_ETSY_ACTOR = "automation-lab~etsy-scraper";
const ETSY_ACTOR = env.APIFY_ETSY_ACTOR_ID || DEFAULT_ETSY_ACTOR;
const TOKEN = env.APIFY_TOKEN;

// Single keep-alive agent shared across all requests. Without an explicit agent,
// Node attaches per-request 'error' listeners on each TLSSocket and trips
// MaxListenersExceededWarning when discovery cross-validates many keywords.
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const client = axios.create({
  baseURL: BASE_URL,
  // run-sync ties the HTTP lifetime to the whole actor run. The actor can be slow
  // (residential proxy + retries) — 600s avoids aborting a slow-but-successful run,
  // which would otherwise return EMPTY and starve a single-seed pipeline of niches.
  timeout: 600_000,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  validateStatus: (s) => s < 500,
  httpsAgent,
});

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
  avgRating: null,
  topRating: null,
  titles: [],
  topTags: [],
};

// Real schema of automation-lab~etsy-scraper items (verified live via probe-apify-fields.ts).
// NOTE: the actor exposes NO sales count and NO review count — only `rating` (stars) and
// `position` (Etsy relevance rank under most_relevant). We derive a weak-but-REAL demand
// proxy from the top-ranked listings instead of fabricating sales numbers.
interface EtsyItem {
  listingId?: string;
  name?: string;
  url?: string;
  imageUrl?: string;
  shop?: string;
  price?: string;
  originalPrice?: string;
  currency?: string;
  onSale?: boolean;
  rating?: number;
  availability?: string;
  position?: number; // Etsy search rank for this query (1 = top); lower = better-converting
}

function parsePrice(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isFinite(cleaned) && cleaned > 0 ? cleaned : null;
}

export async function fetchMarketplaceSignals(keyword: string): Promise<MarketplaceSignals> {
  if (!TOKEN) {
    console.warn(`  ⚠️  APIFY_TOKEN not set — skipping marketplace signals for "${keyword}"`);
    return EMPTY;
  }

  const market = getConfig().market;

  const cached = readApifyCache(market.country, keyword);
  if (cached) {
    process.stdout.write("[cache] ");
    return cached;
  }

  await throttle();

  try {
    const path = `/acts/${ETSY_ACTOR}/run-sync-get-dataset-items`;
    const body = {
      searchQuery: keyword,
      // 25 is plenty: we only read the top ~8-10 titles/positions for the demand
      // proxy. Fewer items = faster, cheaper runs (the actor scrapes per-page).
      maxItems: 25,
      sort: "most_relevant",
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxyCountry: market.country,
      },
    };

    const res = await client.post<EtsyItem[]>(path, body, {
      params: { token: TOKEN },
    });

    if (res.status !== 200 && res.status !== 201) {
      const detail = typeof res.data === "object" ? JSON.stringify(res.data).slice(0, 200) : "";
      console.warn(`  ⚠️  Apify returned ${res.status} for "${keyword}" (actor="${ETSY_ACTOR}") ${detail}`);
      return EMPTY;
    }

    const items = Array.isArray(res.data) ? res.data : [];
    if (items.length === 0) {
      console.warn(`  ⚠️  Apify returned 0 items for "${keyword}"`);
      return EMPTY;
    }

    const prices = items
      .map((i) => parsePrice(i.price))
      .filter((v): v is number => v !== null);

    // Currency localization check — bail out if <50% of items are in expected currency.
    const currencies = items
      .map((i) => i.currency?.toUpperCase())
      .filter((c): c is string => !!c);
    if (currencies.length >= 5) {
      const matching = currencies.filter((c) => c === market.currency).length;
      if (matching / currencies.length < 0.5) {
        console.warn(
          `  ⚠️  Apify returned <50% ${market.currency} prices for "${keyword}" — bad market localization, discarding`
        );
        return EMPTY;
      }
    }

    const titles = items
      .map((i) => i.name)
      .filter((t): t is string => !!t)
      .slice(0, 10)
      .map((t) => t.slice(0, 120));

    const ratings = items
      .map((i) => i.rating)
      .filter((r): r is number => typeof r === "number" && r > 0);
    const avgRating = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : null;

    // Weak-but-REAL demand proxy: under most_relevant Etsy ranks best-converting
    // listings first. Average the rating of the TOP-positioned listings — these are
    // the closest signal to "what's actually selling" the actor gives us. We do NOT
    // fabricate a sales count (the old rating×10 hack); estMonthlySales stays null.
    const TOP_N = 10;
    const topRatings = items
      .filter((i) => typeof i.rating === "number" && i.rating > 0)
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
      .slice(0, TOP_N)
      .map((i) => i.rating as number);
    const topRating = topRatings.length
      ? topRatings.reduce((a, b) => a + b, 0) / topRatings.length
      : null;

    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

    const signals: MarketplaceSignals = {
      source: "apify",
      // The actor does not expose total listings, so we leave it null and use
      // the sample (depth + top-position ratings + prices) as the demand signal instead.
      listingCount: null,
      avgPrice,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      estMonthlyRevenue: null,
      estMonthlySales: null, // actor has no sales/review data — never fabricate it
      sampledListings: items.length,
      avgRating,
      topRating,
      titles,
      topTags: [],
    };

    writeApifyCache(market.country, keyword, signals);
    return signals;
  } catch (err) {
    console.warn(
      `  ⚠️  Apify fetch failed for "${keyword}": ${err instanceof Error ? err.message : err}`
    );
    return EMPTY;
  }
}

// Map raw listing count → competition score 1..10. Same heuristic regardless of source.
// Currently only used when an explicit total is available; with the sample-only
// approach listingCount is null and Gemini handles competition from titles.
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
