/**
 * Apify Pinterest signal source — actor: fatihtahta~pinterest-scraper-search
 *
 * Searches Pinterest by keyword and extracts two commercial signals:
 *   - promotedRatio: fraction of paid/promoted pins → brands are spending here
 *   - medianFollowers: median creator follower count → established accounts track this niche
 *
 * These proxy for "is this niche commercially validated on Pinterest?" rather than
 * per-pin saves (which the actor does not expose).
 *
 * Behavior notes (verified via probe):
 *   - Actor does NOT respect maxItems/maxCrawledPages — always scrapes the full page (~1000 items)
 *   - We process only the first SAMPLE_SIZE items; cost is fixed per lookup regardless
 *   - Without APIFY_TOKEN, returns EMPTY_PINTEREST and the formula is unchanged
 *
 * Override actor via APIFY_PINTEREST_ACTOR_ID env var.
 */
import axios from "axios";
import https from "node:https";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../lib/env.js";
import { apifyEnabled } from "../lib/apify.js";
import { charge } from "../lib/budget.js";
import type { PinterestSignals } from "./types.js";

const CACHE_DIR = "cache/pinterest";
const TTL_MS = 24 * 60 * 60 * 1000;
const SAMPLE_SIZE = 50; // items to process; actor scrapes full page but we read first N

const BASE_URL = "https://api.apify.com/v2";
const DEFAULT_PINTEREST_ACTOR = "fatihtahta~pinterest-scraper-search";
const TOKEN = env.APIFY_TOKEN;
const PINTEREST_ACTOR = env.APIFY_PINTEREST_ACTOR_ID ?? DEFAULT_PINTEREST_ACTOR;

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 300_000,
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

export const EMPTY_PINTEREST: PinterestSignals = {
  source: "none",
  sampledPins: 0,
  promotedRatio: null,
  medianFollowers: null,
  titles: [],
  trendScore: 0,
};

// Schema from fatihtahta~pinterest-scraper-search (verified via probe)
interface PinterestItem {
  title?: string;
  pin?: {
    title?: string;
    description?: string;
    is_promoted?: boolean;
  };
  creator?: {
    follower_count?: number;
  };
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

function readPinterestCache(keyword: string): PinterestSignals | null {
  const path = join(CACHE_DIR, `${slugify(keyword)}.json`);
  if (!existsSync(path)) return null;
  try {
    const entry = JSON.parse(readFileSync(path, "utf8")) as {
      cachedAt: string;
      signals: PinterestSignals;
    };
    if (Date.now() - new Date(entry.cachedAt).getTime() > TTL_MS) return null;
    return entry.signals;
  } catch {
    return null;
  }
}

function writePinterestCache(keyword: string, signals: PinterestSignals): void {
  if (signals.source === "none") return;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    join(CACHE_DIR, `${slugify(keyword)}.json`),
    JSON.stringify({ cachedAt: new Date().toISOString(), signals }, null, 2)
  );
}

// trendScore = commercial * 0.6 + authority * 0.4
// commercial: promotedRatio → 20% promoted = 10/10 (brands spending = highly commercial)
// authority: log-scale median followers → 1M median ≈ 8.5/10
function computeTrendScore(
  promotedRatio: number | null,
  medianFollowers: number | null
): number {
  if (promotedRatio === null && medianFollowers === null) return 0;

  const commercialScore =
    promotedRatio !== null ? Math.min(10, promotedRatio * 50) : 0;

  const authorityScore =
    medianFollowers !== null && medianFollowers > 0
      ? Math.min(10, (Math.log10(medianFollowers + 1) / Math.log10(1_000_001)) * 10)
      : 0;

  return parseFloat((commercialScore * 0.6 + authorityScore * 0.4).toFixed(2));
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export async function fetchPinterestSignals(keyword: string): Promise<PinterestSignals> {
  // Same kill switch as the Etsy scraper — this actor is billed by Apify too.
  if (!apifyEnabled()) return EMPTY_PINTEREST;

  if (!TOKEN) return EMPTY_PINTEREST;

  const cached = readPinterestCache(keyword);
  if (cached) {
    process.stdout.write("[cache] ");
    return cached;
  }

  charge("apify"); // real (non-cached) scraper call — counts against the run budget
  await throttle();

  try {
    const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`;
    const path = `/acts/${PINTEREST_ACTOR}/run-sync-get-dataset-items`;
    // Actor ignores maxItems/maxCrawledPages — always scrapes full page.
    // We read only SAMPLE_SIZE items after the fact.
    const body = { startUrls: [{ url: searchUrl }] };

    const res = await client.post<PinterestItem[]>(path, body, {
      params: { token: TOKEN },
    });

    if (res.status !== 200 && res.status !== 201) {
      const detail = typeof res.data === "object" ? JSON.stringify(res.data).slice(0, 200) : "";
      console.warn(
        `  ⚠️  Pinterest Apify returned ${res.status} for "${keyword}" (actor="${PINTEREST_ACTOR}") ${detail}`
      );
      return EMPTY_PINTEREST;
    }

    const all = Array.isArray(res.data) ? res.data : [];
    if (all.length === 0) return EMPTY_PINTEREST;

    const items = all.slice(0, SAMPLE_SIZE);

    const promotedCount = items.filter((i) => i.pin?.is_promoted === true).length;
    const promotedRatio = items.length > 0 ? promotedCount / items.length : null;

    const followerCounts = items
      .map((i) => i.creator?.follower_count)
      .filter((n): n is number => typeof n === "number" && n > 0);

    const medianFollowers = median(followerCounts);

    const titles = items
      .map((i) => i.pin?.title ?? i.title ?? "")
      .filter(Boolean)
      .slice(0, 6)
      .map((t) => t.slice(0, 100));

    const signals: PinterestSignals = {
      source: "apify",
      sampledPins: all.length, // report total found (even if we only process SAMPLE_SIZE)
      promotedRatio,
      medianFollowers,
      titles,
      trendScore: computeTrendScore(promotedRatio, medianFollowers),
    };

    writePinterestCache(keyword, signals);
    return signals;
  } catch (err) {
    console.warn(
      `  ⚠️  Pinterest fetch failed for "${keyword}": ${err instanceof Error ? err.message : err}`
    );
    return EMPTY_PINTEREST;
  }
}
