/**
 * Research module — discovers trending Etsy niches.
 * Usage:
 *   pnpm research                                      # uses config.yaml keywords_seed
 *   pnpm research --seeds "funny cat,dog mom"          # CLI override
 * Output: research-results/YYYY-MM-DD.json with ranked niches.
 */
import { writeFileSync, mkdirSync } from "fs";
import { searchNiche } from "./trends-source.js";
import { fetchMarketplaceSignals } from "./everbee-source.js";
import { analyzeNiche, rankNiches } from "./niche-analyzer.js";
import { getConfig } from "../lib/config.js";
import type { ResearchResult, NicheData } from "./types.js";

function parseArgs(): string[] {
  const seedsFlag = process.argv.indexOf("--seeds");
  if (seedsFlag !== -1 && process.argv[seedsFlag + 1]) {
    return (process.argv[seedsFlag + 1] as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const seeds = getConfig().research.keywords_seed;
  if (!seeds.length) {
    console.error('No seeds. Provide --seeds "k1,k2" or fill research.keywords_seed in config.yaml');
    process.exit(1);
  }
  return seeds;
}

async function main() {
  const seeds = parseArgs();
  const cfg = getConfig().research;
  console.log(`\n🔍 Research starting — ${seeds.length} seeds [geo=${cfg.geo}]: ${seeds.join(", ")}\n`);

  // Step 1: For each seed, fetch Google Trends + Etsy signals sequentially.
  // Both endpoints rate-limit; sequential is the safe path.
  console.log("📥 Fetching signals (Google Trends + EverBee)...");
  const nicheData: NicheData[] = [];
  for (const keyword of seeds) {
    process.stdout.write(`  "${keyword}" — trends...`);
    const trends = await searchNiche(keyword, cfg.geo);
    process.stdout.write(` marketplace...`);
    const marketplace = await fetchMarketplaceSignals(keyword);
    const merged: NicheData = { ...trends, marketplace };
    nicheData.push(merged);
    console.log(
      ` ✓ trends_avg=${trends.avgInterest.toFixed(0)}, listings=${marketplace.listingCount ?? "?"}, avg=$${marketplace.avgPrice?.toFixed(2) ?? "?"} [${marketplace.source}]`
    );
  }

  // Step 2: Gemini analysis — fed with real Etsy + Trends data
  console.log("\n🤖 Analyzing with Gemini Pro...");
  const analyses = [];
  for (const data of nicheData) {
    if (data.samplePoints === 0 && data.marketplace.listingCount === null) {
      console.log(`  Skipping "${data.keyword}" — no signals from either source`);
      continue;
    }
    process.stdout.write(`  Analyzing "${data.keyword}"... `);
    try {
      const analysis = await analyzeNiche(data);
      analyses.push(analysis);
      console.log(
        `demand=${analysis.demandScore}/10, competition=${analysis.competitionScore}/10, $${analysis.avgPrice.toFixed(2)}, score=${analysis.score.toFixed(2)}`
      );
    } catch (err) {
      console.error(`FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  // Step 3: Rank + filter by min_demand_score
  const ranked = rankNiches(analyses)
    .filter((n) => n.demandScore >= cfg.min_demand_score)
    .slice(0, cfg.max_niches);

  const result: ResearchResult = {
    date: new Date().toISOString().split("T")[0] as string,
    seeds,
    topNiches: ranked,
  };

  mkdirSync("research-results", { recursive: true });
  const filename = `research-results/${result.date}.json`;
  writeFileSync(filename, JSON.stringify(result, null, 2));

  // Step 4: Summary
  console.log("\n" + "─".repeat(60));
  console.log(`📊 Top ${ranked.length} nichos (filtered by demand >= ${cfg.min_demand_score}):\n`);
  ranked.forEach((n, i) => {
    console.log(
      `  ${i + 1}. "${n.keyword}" — score ${n.score.toFixed(2)} ` +
      `(demand ${n.demandScore}/10, competition ${n.competitionScore}/10, ` +
      `${n.listingCount?.toLocaleString() ?? "?"} listings, avg $${n.avgPrice.toFixed(2)}, src=${n.marketplaceSource})`
    );
    if (n.subNiches.length > 0) {
      console.log(`     Sub-nichos: ${n.subNiches.slice(0, 3).join(", ")}`);
    }
    if (n.designIdeas.length > 0) {
      console.log(`     Idea top: "${n.designIdeas[0]?.concept}" → ${n.designIdeas[0]?.targetProduct}`);
    }
  });

  console.log(`\n✅ Guardado en ${filename}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Research failed:", err);
    process.exit(1);
  });
