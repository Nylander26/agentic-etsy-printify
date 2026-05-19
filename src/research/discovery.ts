/**
 * Autonomous niche discovery.
 *
 * Replaces hand-typed `keywords_seed`. Gemini proposes POD-friendly niches for
 * the configured market using its own seasonal/cultural knowledge, then each
 * candidate is cross-validated against Apify's Etsy listing count to drop
 * niches that are too small or too saturated.
 *
 * (Google Trends was removed: the public dailyTrends endpoint rate-limits
 * aggressively and the dep `google-trends-api` is unmaintained. The market
 * signal we trust is the Apify listing pull below.)
 *
 * Caller (research/index.ts or pipeline.ts) is responsible for asking the
 * user to approve which candidates proceed to generation.
 */
import { generateJSON } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { fetchMarketplaceSignals } from "./apify-source.js";

export interface DiscoveredNiche {
  keyword: string;
  rationale: string;          // Gemini's justification for this niche
  expectedDemand: number;     // 1-10 from Gemini
  sampledListings: number;    // size of the Apify sample (max 50)
  avgPrice: number | null;    // avg USD across sampled listings
  avgTitlePreview: string[];  // top 3 sampled titles for human preview
  source: "auto-discovery";
}

interface GeminiDiscoveryResponse {
  candidates: Array<{
    keyword: string;
    rationale: string;
    expectedDemand: number;
  }>;
}

async function geminiProposePodNiches(
  targetCount: number
): Promise<Array<{ keyword: string; rationale: string; expectedDemand: number }>> {
  const cfg = getConfig();
  const today = new Date().toISOString().slice(0, 10);
  const windowDays = cfg.research.discovery_window_days;

  const prompt = `
You are a Print-on-Demand (POD) niche scout for the ${cfg.market.audience} segment on Etsy.

Today is ${today}. Propose niches trending or seasonal over the next ${windowDays} days that translate to sellable POD products (t-shirts, mugs, posters).

YOUR JOB
Identify the top ${targetCount} niches that meet ALL of:
1. Translate cleanly to a wearable/printable design (not abstract concepts, not news events).
2. Have a defined buyer identity (mom/dad/nurse/teacher/cat-parent/runner/gamer/etc.) or seasonal hook for the next 30 days.
3. Sell well to ${cfg.market.audience} specifically (US humor, US holidays, US idioms).
4. Are NOT one-off news/celebrity/election spikes — only sustainable for at least 4 weeks.

INSTRUCTIONS
- Lean on evergreen US POD niches that are currently rising or seasonal for the next month.
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
 * For each candidate, pull the Apify sample (titles + prices + ratings).
 * The actor does not expose total Etsy listings, and scraping Etsy directly is
 * disallowed, so we use sample quality as the discovery filter:
 *   - 0 sampled items → reject (no marketplace presence in this market)
 *   - currency mismatch → reject (handled upstream in fetchMarketplaceSignals)
 *   - otherwise keep; later research+analysis evaluates competition qualitatively
 */
async function crossValidateWithApify(
  candidates: Array<{ keyword: string; rationale: string; expectedDemand: number }>
): Promise<DiscoveredNiche[]> {
  const validated: DiscoveredNiche[] = [];

  for (const c of candidates) {
    process.stdout.write(`  Apify sample "${c.keyword}"... `);
    const signals = await fetchMarketplaceSignals(c.keyword);

    if (signals.sampledListings === 0) {
      console.log(`0 items — descartado (sin presencia en marketplace)`);
      continue;
    }

    console.log(
      `sample=${signals.sampledListings}, avg=$${signals.avgPrice?.toFixed(2) ?? "?"}`
    );

    validated.push({
      keyword: c.keyword,
      rationale: c.rationale,
      expectedDemand: c.expectedDemand,
      sampledListings: signals.sampledListings,
      avgPrice: signals.avgPrice,
      avgTitlePreview: signals.titles.slice(0, 3),
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
  const targetCount = cfg.research.discovery_candidates;

  console.log(`\n🔍 Discovery — market=${cfg.market.country}, candidatos=${targetCount}\n`);

  console.log("  🤖 Gemini proponiendo nichos POD (sin Trends — solo conocimiento estacional)...");
  const filtered = await geminiProposePodNiches(targetCount);
  console.log(`  ✓ ${filtered.length} candidatos POD identificados`);

  if (filtered.length === 0) {
    console.warn("  ⚠️  Gemini no devolvió candidatos. Revisar prompt.");
    return [];
  }

  console.log(`\n  🛒 Cross-validando con Apify (sample de listings)...`);
  const validated = await crossValidateWithApify(filtered);
  console.log(`\n  ✓ ${validated.length}/${filtered.length} candidatos con presencia en marketplace`);

  // Sort by Gemini's expectedDemand only — without a real total-listings signal
  // we can't score saturation; the Gemini research+analysis pass will rank
  // these qualitatively from the sampled titles.
  validated.sort((a, b) => b.expectedDemand - a.expectedDemand);

  return validated;
}
