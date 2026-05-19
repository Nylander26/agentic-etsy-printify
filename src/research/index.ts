/**
 * Research module — discovers trending Etsy niches.
 * Usage:
 *   pnpm research                                      # uses config.yaml keywords_seed
 *   pnpm research --seeds "funny cat,dog mom"          # CLI override
 * Output: research-results/YYYY-MM-DD.json with ranked niches.
 */
import { writeFileSync, mkdirSync } from "fs";
import { fetchMarketplaceSignals } from "./apify-source.js";
import { analyzeNiche, rankNiches } from "./niche-analyzer.js";
import { discoverNiches } from "./discovery.js";
import { askApproval } from "../lib/approval.js";
import { getConfig } from "../lib/config.js";
import type { ResearchResult, NicheData } from "./types.js";

function explicitSeeds(): string[] | null {
  const seedsFlag = process.argv.indexOf("--seeds");
  if (seedsFlag !== -1 && process.argv[seedsFlag + 1]) {
    return (process.argv[seedsFlag + 1] as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

/**
 * Resolves the list of seed keywords for this run. Precedence:
 *   1. --seeds CLI flag (always wins, overrides everything)
 *   2. auto_discover=true → run discovery + ask user to approve
 *   3. keywords_seed in config.yaml
 */
async function resolveSeeds(): Promise<string[]> {
  const cliSeeds = explicitSeeds();
  if (cliSeeds && cliSeeds.length > 0) {
    console.log(`\n🔑 Usando seeds del CLI: ${cliSeeds.join(", ")}`);
    return cliSeeds;
  }

  const cfg = getConfig().research;
  if (cfg.auto_discover) {
    const discovered = await discoverNiches();
    if (discovered.length === 0) {
      console.error("\n❌ Discovery no devolvió candidatos. Aborta o usa --seeds manualmente.");
      process.exit(1);
    }

    const options = discovered.map((n) => ({
      label: n.keyword,
      detail: `demand≈${n.expectedDemand}/10 · sample=${n.sampledListings} · ${n.avgPrice !== null ? "$" + n.avgPrice.toFixed(2) : "$?"} · ${n.rationale}`,
    }));

    const choice = await askApproval(
      `Discovery encontró ${discovered.length} nichos POD para ${getConfig().market.audience}. ¿Cuáles procesamos?`,
      options
    );

    if (choice.kind === "cancel") {
      console.log("\n⏹  Run cancelado por el usuario.");
      process.exit(0);
    }
    if (choice.kind === "all") return discovered.map((n) => n.keyword);
    return choice.indices.map((i) => discovered[i]?.keyword).filter((k): k is string => !!k);
  }

  const seeds = cfg.keywords_seed;
  if (!seeds.length) {
    console.error(
      'Sin seeds. Opciones:\n' +
      '  1. CLI:    pnpm research --seeds "k1,k2"\n' +
      '  2. Auto:   activa research.auto_discover=true en config.yaml\n' +
      '  3. Manual: llena research.keywords_seed en config.yaml'
    );
    process.exit(1);
  }
  return seeds;
}

async function main() {
  const seeds = await resolveSeeds();
  const cfg = getConfig().research;
  console.log(`\n🔍 Research starting — ${seeds.length} seeds [geo=${cfg.geo}]: ${seeds.join(", ")}\n`);

  // Step 1: For each seed, fetch Etsy marketplace signals via Apify.
  console.log(`📥 Fetching Apify Etsy signals (market=${getConfig().market.country})...`);
  const nicheData: NicheData[] = [];
  for (const keyword of seeds) {
    process.stdout.write(`  "${keyword}" — marketplace...`);
    const marketplace = await fetchMarketplaceSignals(keyword);
    const merged: NicheData = { keyword, geo: cfg.geo, marketplace };
    nicheData.push(merged);
    console.log(
      ` ✓ listings=${marketplace.listingCount ?? "?"}, avg=$${marketplace.avgPrice?.toFixed(2) ?? "?"} [${marketplace.source}]`
    );
  }

  // Step 2: Gemini analysis — fed with Etsy marketplace data
  console.log("\n🤖 Analyzing with Gemini Pro...");
  const analyses = [];
  for (const data of nicheData) {
    if (data.marketplace.source === "none" && data.marketplace.listingCount === null) {
      console.log(`  Skipping "${data.keyword}" — no marketplace signal`);
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
