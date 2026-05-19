/**
 * On-disk cache for Apify marketplace lookups.
 *
 * Discover and research both call fetchMarketplaceSignals() for the same
 * keywords, paying Apify twice. This cache keys by `{country}-{keyword-slug}`
 * and treats entries newer than TTL_MS as fresh.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MarketplaceSignals } from "../research/types.js";

const CACHE_DIR = "cache/apify";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  cachedAt: string; // ISO timestamp
  keyword: string;
  country: string;
  signals: MarketplaceSignals;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function cachePath(country: string, keyword: string): string {
  return join(CACHE_DIR, `${country.toLowerCase()}-${slugify(keyword)}.json`);
}

export function readApifyCache(country: string, keyword: string): MarketplaceSignals | null {
  const path = cachePath(country, keyword);
  if (!existsSync(path)) return null;

  try {
    const entry = JSON.parse(readFileSync(path, "utf8")) as CacheEntry;
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age > TTL_MS) return null;
    return entry.signals;
  } catch {
    return null;
  }
}

export function writeApifyCache(
  country: string,
  keyword: string,
  signals: MarketplaceSignals
): void {
  if (signals.source === "none") return; // never cache empty/failed lookups
  mkdirSync(CACHE_DIR, { recursive: true });
  const entry: CacheEntry = {
    cachedAt: new Date().toISOString(),
    keyword,
    country,
    signals,
  };
  writeFileSync(cachePath(country, keyword), JSON.stringify(entry, null, 2));
}
