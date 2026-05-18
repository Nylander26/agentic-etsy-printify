/**
 * Apify Etsy marketplace data source.
 *
 * Replaces the Everbee stub. Calls a public Etsy search scraper actor on Apify
 * (default: `automation-lab/etsy-scraper`) and aggregates the results into the
 * shared `MarketplaceSignals` shape used by the niche analyzer.
 *
 * Apify acts as a scraper-as-a-service: requests go from Apify's infrastructure
 * (US residential proxy by default), so the user's blocked Etsy dev app is
 * irrelevant here.
 *
 * Without APIFY_TOKEN set, returns an empty `none` signal and the pipeline
 * falls back to Google Trends + Gemini estimates only.
 */
import axios from "axios";
import { env } from "../lib/env.js";
import { getConfig } from "../lib/config.js";
import type { MarketplaceSignals } from "./types.js";

const BASE_URL = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "automation-lab~etsy-scraper";
const ACTOR = env.APIFY_ETSY_ACTOR_ID || DEFAULT_ACTOR;
const TOKEN = env.APIFY_TOKEN;

// Shared axios instance with keep-alive — avoids "MaxListenersExceededWarning"
// when discovery cross-validates many keywords in sequence.
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 120_000,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  validateStatus: (s) => s < 500,
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
  titles: [],
  topTags: [],
};

// Loose typing — different public actors return slightly different shapes,
// so we defensively pull whatever fields are present.
interface EtsyItem {
  title?: string;
  name?: string;
  price?: number | string | { amount?: number; currency?: string; value?: number };
  currency?: string;
  currencyCode?: string;
  tags?: string[];
  totalResults?: number;
  totalListings?: number;
  totalCount?: number;
  numFavorers?: number;
  sales?: number;
}

function extractPrice(it: EtsyItem): { value: number | null; currency: string | null } {
  const raw = it.price;
  const currencyHint = it.currency ?? it.currencyCode ?? null;
  if (typeof raw === "number" && raw > 0) return { value: raw, currency: currencyHint };
  if (typeof raw === "string") {
    const cleaned = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return { value: isFinite(cleaned) && cleaned > 0 ? cleaned : null, currency: currencyHint };
  }
  if (raw && typeof raw === "object") {
    const v = raw.amount ?? raw.value ?? null;
    const cur = raw.currency ?? currencyHint;
    return { value: typeof v === "number" && v > 0 ? v : null, currency: cur };
  }
  return { value: null, currency: currencyHint };
}

export async function fetchMarketplaceSignals(keyword: string): Promise<MarketplaceSignals> {
  if (!TOKEN) {
    console.warn(`  ⚠️  APIFY_TOKEN not set — skipping marketplace signals for "${keyword}"`);
    return EMPTY;
  }

  const market = getConfig().market;
  await throttle();

  try {
    const path = `/acts/${ACTOR}/run-sync-get-dataset-items`;
    const body = {
      searchQuery: keyword,
      maxItems: 50,
      sort: "most_relevant",
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxyCountry: market.country, // forces US residential proxy by default
      },
    };

    const res = await client.post<EtsyItem[]>(path, body, {
      params: { token: TOKEN },
    });

    if (res.status !== 200 && res.status !== 201) {
      const detail = typeof res.data === "object" ? JSON.stringify(res.data).slice(0, 200) : "";
      console.warn(`  ⚠️  Apify returned ${res.status} for "${keyword}" (actor="${ACTOR}") ${detail}`);
      return EMPTY;
    }

    const items = Array.isArray(res.data) ? res.data : [];
    if (items.length === 0) {
      console.warn(`  ⚠️  Apify returned 0 items for "${keyword}"`);
      return EMPTY;
    }

    const parsedPrices = items.map(extractPrice);
    const prices = parsedPrices
      .map((p) => p.value)
      .filter((v): v is number => v !== null);

    // Sanity check — if the actor returned non-USD pricing for the majority of
    // items, we're not looking at the US market. Bail out rather than feed
    // mismatched data to the niche scorer.
    const currencies = parsedPrices
      .map((p) => p.currency?.toUpperCase())
      .filter((c): c is string => !!c);
    if (currencies.length >= 5) {
      const usd = currencies.filter((c) => c === market.currency).length;
      if (usd / currencies.length < 0.5) {
        console.warn(
          `  ⚠️  Apify returned <50% ${market.currency} prices for "${keyword}" — bad market localization, discarding`
        );
        return EMPTY;
      }
    }

    // totalListings: some actors expose this on the first item or on a metadata
    // wrapper. Fall back to sampled count if unavailable.
    const first = items[0] ?? {};
    const reportedTotal =
      first.totalResults ?? first.totalListings ?? first.totalCount ?? null;

    const titles = items
      .map((i) => i.title ?? i.name)
      .filter((t): t is string => !!t)
      .slice(0, 10)
      .map((t) => t.slice(0, 120));

    const tagSet = new Set<string>();
    for (const i of items) {
      for (const tag of i.tags ?? []) tagSet.add(tag);
    }

    // Heuristic monthly sales/revenue estimate from numFavorers (Etsy's only
    // public signal correlated with sales velocity). Not used unless present.
    const favorers = items
      .map((i) => i.numFavorers ?? i.sales ?? 0)
      .filter((n) => typeof n === "number");
    const avgFavorers = favorers.length
      ? favorers.reduce((a, b) => a + b, 0) / favorers.length
      : null;
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const estMonthlyRevenue =
      avgFavorers !== null && avgPrice !== null
        ? Math.round(avgFavorers * 0.02 * avgPrice) // ~2% favorers → buyer conversion (rough proxy)
        : null;
    const estMonthlySales =
      avgFavorers !== null ? Math.round(avgFavorers * 0.02) : null;

    return {
      source: "apify",
      listingCount: reportedTotal ?? items.length,
      avgPrice,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      estMonthlyRevenue,
      estMonthlySales,
      sampledListings: items.length,
      titles,
      topTags: Array.from(tagSet).slice(0, 15),
    };
  } catch (err) {
    console.warn(
      `  ⚠️  Apify fetch failed for "${keyword}": ${err instanceof Error ? err.message : err}`
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
