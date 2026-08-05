/**
 * Research module — discovers trending Etsy niches.
 * Usage:
 *   pnpm research                                      # uses config.yaml keywords_seed
 *   pnpm research --seeds "funny cat,dog mom"          # CLI override
 * Output: research-results/YYYY-MM-DD.json with ranked niches.
 */
import { writeFileSync, mkdirSync } from "fs";
import { fetchMarketplaceSignals } from "./apify-source.js";
import { fetchPinterestSignals } from "./pinterest-source.js";
import { analyzeNiche, rankNiches } from "./niche-analyzer.js";
import { discoverNiches } from "./discovery.js";
import {
  preResearchGuard,
  hasMarketplaceSignal,
  qualifyNiche,
  pinterestStatusLabel,
} from "./niche-filter.js";
import { askApproval } from "../lib/approval.js";
import { apifyEnabled, APIFY_OFF_LABEL } from "../lib/apify.js";
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
      detail: [
        n.anchorEvent ? `[${n.anchorEvent}]` : "[evergreen]",
        `demand≈${n.expectedDemand}/10`,
        n.rationale.slice(0, 80),
      ].join(" · "),
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

  // Step 1: For each seed, fetch Etsy + Pinterest signals in sequence (throttled per source).
  console.log(`📥 Fetching Apify signals (Etsy + Pinterest, market=${getConfig().market.country})...`);
  const nicheData: NicheData[] = [];
  for (const keyword of seeds) {
    // Checkpoint 1 (shared): product coherence.
    const guard = preResearchGuard(keyword);
    if (!guard.ok) {
      console.log(`  ⊘ "${keyword}" — descartado: ${guard.reason}`);
      continue;
    }
    process.stdout.write(`  "${keyword}" — Etsy...`);
    const marketplace = await fetchMarketplaceSignals(keyword);
    process.stdout.write(
      apifyEnabled()
        ? ` ✓ avg=$${marketplace.avgPrice?.toFixed(2) ?? "?"} [${marketplace.source}] | Pinterest...`
        : ` ${APIFY_OFF_LABEL} | Pinterest...`
    );
    const pinterest = await fetchPinterestSignals(keyword);
    console.log(` ✓ ${pinterestStatusLabel(pinterest)}`);
    nicheData.push({ keyword, geo: cfg.geo, marketplace, pinterest });
  }

  // Step 2: Gemini analysis — fed with Etsy marketplace data
  console.log("\n🤖 Analyzing with Gemini Pro...");
  const analyses = [];
  for (const data of nicheData) {
    // Checkpoint 2 (shared): marketplace presence.
    if (!hasMarketplaceSignal(data.marketplace)) {
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

  // Step 3: Rank + filter — Checkpoint 3 (shared): demand + visibility qualification.
  const ranked = rankNiches(analyses)
    .filter((n) => {
      const q = qualifyNiche(n);
      if (!q.ok) console.log(`  ⊘ "${n.keyword}" — ${q.reason}`);
      return q.ok;
    })
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
  console.log(`📊 Top ${ranked.length} nichos (demand >= ${cfg.min_demand_score} & visibilidad >= ${cfg.min_visibility_score}):\n`);
  ranked.forEach((n, i) => {
    const pinterestLabel = n.pinterestScore > 0 ? `, pinterest=${n.pinterestScore}/10` : "";
    console.log(
      `  ${i + 1}. "${n.keyword}" — score ${n.score.toFixed(2)} ` +
      `(demand ${n.demandScore}/10, competition ${n.competitionScore}/10, ` +
      `${n.listingCount?.toLocaleString() ?? "?"} listings, avg $${n.avgPrice.toFixed(2)}${pinterestLabel}, src=${n.marketplaceSource})`
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
