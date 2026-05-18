/**
 * Autonomous niche discovery.
 *
 * Replaces hand-typed `keywords_seed`. Pulls real-time trending signals from
 * Google Trends + lets Gemini Pro filter and cluster them into POD-friendly
 * niches for the configured market. Output is a ranked list of candidate
 * niches with rationale + a listingCount sanity check from Apify.
 *
 * Caller (research/index.ts or pipeline.ts) is responsible for asking the
 * user to approve which candidates proceed to generation.
 */
import googleTrends from "google-trends-api";
import { generateJSON } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { fetchMarketplaceSignals, competitionFromListings } from "./apify-source.js";

interface DailyTrendsResponse {
  default: {
    trendingSearchesDays: Array<{
      date: string;
      trendingSearches: Array<{
        title?: { query: string };
        formattedTraffic?: string;
        relatedQueries?: Array<{ query: string }>;
      }>;
    }>;
  };
}

type TrendsModule = {
  dailyTrends(opts: { geo?: string; trendDate?: Date }): Promise<string>;
};
const trends = googleTrends as unknown as TrendsModule;

export interface DiscoveredNiche {
  keyword: string;
  rationale: string;          // Gemini's justification for this niche
  expectedDemand: number;     // 1-10 from Gemini
  listingCount: number | null;
  competitionScore: number | null;
  source: "auto-discovery";
}

const GAP_MS = 6000;
let lastTrendsCall = 0;
async function throttleTrends(): Promise<void> {
  const wait = GAP_MS - (Date.now() - lastTrendsCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastTrendsCall = Date.now();
}

function parseTrafficNumber(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[+,]/g, "").trim();
  if (cleaned.endsWith("M")) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.endsWith("K")) return parseFloat(cleaned) * 1_000;
  return parseFloat(cleaned) || 0;
}

/**
 * Step 1 — Raw signal: pull Google Trends dailyTrends for the last N days,
 * aggregate by query frequency × traffic. Returns the top `limit` queries.
 */
async function pullRawTrending(windowDays: number, geo: string, limit: number): Promise<
  Array<{ query: string; traffic: number; appearances: number }>
> {
  const aggregated = new Map<string, { traffic: number; appearances: number }>();

  for (let i = 0; i < windowDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    await throttleTrends();
    let raw: string;
    try {
      raw = await trends.dailyTrends({ geo, trendDate: date });
    } catch (err) {
      console.warn(`  ⚠️  dailyTrends failed for ${date.toISOString().slice(0, 10)}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    if (!raw || raw.trim().startsWith("<")) {
      console.warn(`  ⚠️  dailyTrends rate-limited or empty for ${date.toISOString().slice(0, 10)}`);
      continue;
    }

    let parsed: DailyTrendsResponse;
    try {
      parsed = JSON.parse(raw) as DailyTrendsResponse;
    } catch {
      continue;
    }

    const days = parsed.default?.trendingSearchesDays ?? [];
    for (const day of days) {
      for (const search of day.trendingSearches ?? []) {
        const q = search.title?.query;
        if (!q) continue;
        const traffic = parseTrafficNumber(search.formattedTraffic);
        const existing = aggregated.get(q) ?? { traffic: 0, appearances: 0 };
        aggregated.set(q, {
          traffic: existing.traffic + traffic,
          appearances: existing.appearances + 1,
        });
      }
    }
  }

  return Array.from(aggregated.entries())
    .map(([query, data]) => ({ query, ...data }))
    .sort((a, b) => b.appearances * b.traffic - a.appearances * a.traffic)
    .slice(0, limit);
}

/**
 * Step 2 — Gemini filters raw trending signal into POD-relevant niches for the
 * configured market. Augments with Gemini's own knowledge of evergreen POD
 * trends in case the raw signal is noisy (news/events/celebrities dominate
 * daily trends).
 */
interface GeminiDiscoveryResponse {
  candidates: Array<{
    keyword: string;
    rationale: string;
    expectedDemand: number;
  }>;
}

async function geminiFilterToPodNiches(
  rawTrending: Array<{ query: string; traffic: number; appearances: number }>,
  targetCount: number
): Promise<Array<{ keyword: string; rationale: string; expectedDemand: number }>> {
  const cfg = getConfig();
  const today = new Date().toISOString().slice(0, 10);
  const windowDays = cfg.research.discovery_window_days;
  const trendingList = rawTrending
    .slice(0, 50)
    .map((t) => `- "${t.query}" (traffic ~${t.traffic}, appearances ${t.appearances})`)
    .join("\n");

  const prompt = `
You are a Print-on-Demand (POD) niche scout for the ${cfg.market.audience} segment on Etsy.

Today is ${today}. You are looking for niches trending over the last ${windowDays} days that translate to sellable POD products (t-shirts, mugs, posters).

RAW SIGNAL — top Google Trends daily searches in ${cfg.market.country} for the past ${windowDays} days:
${trendingList || "(no raw signal available — use your own knowledge of current US POD trends)"}

YOUR JOB
Identify the top ${targetCount} niches that meet ALL of:
1. Translate cleanly to a wearable/printable design (not abstract concepts, not news events).
2. Have a defined buyer identity (mom/dad/nurse/teacher/cat-parent/runner/gamer/etc.) or seasonal hook for the next 30 days.
3. Sell well to ${cfg.market.audience} specifically (US humor, US holidays, US idioms).
4. Are NOT one-off news/celebrity/election spikes — only sustainable for at least 4 weeks.

INSTRUCTIONS
- If the raw signal is dominated by news/events, IGNORE it and propose ${targetCount} evergreen US POD niches that are currently rising or seasonal for the next month.
- Each keyword should be 2-5 words, Etsy-search-friendly (e.g. "funny cat dad shirt", "nurse appreciation week", "retro 80s sunset poster").
- Rationale should be ONE sentence: why this niche, who buys it, and any seasonal angle.
- expectedDemand is 1-10 based on your read of the current market.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "candidates": [
    { "keyword": "...", "rationale": "...", "expectedDemand": 7 },
    ...
  ]
}

Return exactly ${targetCount} candidates.
`.trim();

  const result = await generateJSON<GeminiDiscoveryResponse>(prompt);
  return result.candidates ?? [];
}

/**
 * Step 3 — For each candidate, pull listingCount from Apify to filter out
 * niches that are either too saturated (>2M listings) or too small (<500).
 */
async function crossValidateWithApify(
  candidates: Array<{ keyword: string; rationale: string; expectedDemand: number }>
): Promise<DiscoveredNiche[]> {
  const validated: DiscoveredNiche[] = [];

  for (const c of candidates) {
    process.stdout.write(`  Apify "${c.keyword}"... `);
    const signals = await fetchMarketplaceSignals(c.keyword);
    const competitionScore = competitionFromListings(signals.listingCount);

    if (signals.listingCount !== null) {
      console.log(`listings=${signals.listingCount.toLocaleString()}, competition=${competitionScore}/10`);
    } else {
      console.log(`(no data)`);
    }

    // Filter extremes
    if (signals.listingCount !== null) {
      if (signals.listingCount < 500) {
        console.log(`    → descartado: < 500 listings (audiencia insuficiente)`);
        continue;
      }
      if (signals.listingCount > 2_000_000) {
        console.log(`    → descartado: > 2M listings (saturado)`);
        continue;
      }
    }

    validated.push({
      keyword: c.keyword,
      rationale: c.rationale,
      expectedDemand: c.expectedDemand,
      listingCount: signals.listingCount,
      competitionScore,
      source: "auto-discovery",
    });
  }

  return validated;
}

/**
 * Top-level entry point. Returns the final ranked list of discovered niches,
 * ready to be presented to the user for approval.
 */
export async function discoverNiches(): Promise<DiscoveredNiche[]> {
  const cfg = getConfig();
  const windowDays = cfg.research.discovery_window_days;
  const targetCount = cfg.research.discovery_candidates;

  console.log(`\n🔍 Discovery — ventana=${windowDays}d, market=${cfg.market.country}, candidatos=${targetCount}\n`);

  console.log("  📡 Pulleando Google Trends dailyTrends (best-effort)...");
  const raw = await pullRawTrending(windowDays, cfg.research.geo, 100);
  if (raw.length === 0) {
    console.log("  ℹ️  Trends sin datos (rate-limit del endpoint público) — Gemini propondrá nichos basados en su conocimiento estacional");
  } else {
    console.log(`  ✓ ${raw.length} queries únicas en raw signal`);
  }

  console.log("\n  🤖 Gemini filtrando hacia nichos POD...");
  const filtered = await geminiFilterToPodNiches(raw, targetCount);
  console.log(`  ✓ ${filtered.length} candidatos POD identificados`);

  if (filtered.length === 0) {
    console.warn("  ⚠️  Gemini no devolvió candidatos. Revisar prompt o raw signal.");
    return [];
  }

  console.log(`\n  🛒 Cross-validando con Apify (listing counts reales)...`);
  const validated = await crossValidateWithApify(filtered);
  console.log(`\n  ✓ ${validated.length}/${filtered.length} candidatos pasaron filtros de saturación`);

  // Sort by expectedDemand (Gemini's confidence) × competition fit
  // (prefer mid-range competition where realistic for new shops)
  validated.sort((a, b) => {
    const score = (n: DiscoveredNiche) => {
      const compFit = n.competitionScore !== null
        ? 10 - Math.abs(n.competitionScore - 5)  // peak at competition=5
        : 5;
      return n.expectedDemand * 2 + compFit;
    };
    return score(b) - score(a);
  });

  return validated;
}
