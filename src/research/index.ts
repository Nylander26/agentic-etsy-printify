/**
 * Semana 2 entregable — módulo de research.
 * Uso: pnpm research --seeds "funny cat,dog mom,nurse life,hiking lover"
 * Output: research-results/YYYY-MM-DD.json con top 10 nichos rankeados.
 */
import { writeFileSync, mkdirSync } from "fs";
import { searchNiche } from "./trends-source.js";
import { analyzeNiche, rankNiches } from "./niche-analyzer.js";
import type { ResearchResult } from "./types.js";

function parseArgs(): string[] {
  const seedsFlag = process.argv.indexOf("--seeds");
  if (seedsFlag === -1 || !process.argv[seedsFlag + 1]) {
    console.error('Usage: pnpm research --seeds "keyword1,keyword2,keyword3"');
    process.exit(1);
  }
  return (process.argv[seedsFlag + 1] as string)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Process seeds with concurrency limit to avoid hammering APIs
async function withConcurrency<T>(
  items: string[],
  fn: (item: string) => Promise<T>,
  concurrency = 2
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const seeds = parseArgs();
  console.log(`\n🔍 Research starting — ${seeds.length} seeds: ${seeds.join(", ")}\n`);

  // Step 1: Fetch Google Trends data for each seed (sequential — Trends rate-limits hard)
  console.log("📥 Fetching Google Trends data...");
  const nicheData = await withConcurrency(seeds, async (keyword) => {
    process.stdout.write(`  Trends "${keyword}"... `);
    const data = await searchNiche(keyword);
    console.log(
      `avg=${data.avgInterest.toFixed(0)}, peak=${data.peakInterest}, trend=${data.trend}`
    );
    return data;
  }, 1);

  // Step 2: Analyze each niche with Gemini Pro (sequential to avoid rate limits)
  console.log("\n🤖 Analyzing with Gemini Pro...");
  const analyses = [];
  for (const data of nicheData) {
    if (data.samplePoints === 0) {
      console.log(`  Skipping "${data.keyword}" — no Trends data`);
      continue;
    }
    process.stdout.write(`  Analyzing "${data.keyword}"... `);
    try {
      const analysis = await analyzeNiche(data);
      analyses.push(analysis);
      console.log(
        `demand=${analysis.demandScore}/10, competition=${analysis.competitionScore}/10, score=${analysis.score.toFixed(2)}`
      );
    } catch (err) {
      console.error(`FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  // Step 3: Rank and save top 10
  const ranked = rankNiches(analyses).slice(0, 10);

  const result: ResearchResult = {
    date: new Date().toISOString().split("T")[0] as string,
    seeds,
    topNiches: ranked,
  };

  mkdirSync("research-results", { recursive: true });
  const filename = `research-results/${result.date}.json`;
  writeFileSync(filename, JSON.stringify(result, null, 2));

  // Step 4: Print summary
  console.log("\n" + "─".repeat(60));
  console.log(`📊 Top ${ranked.length} nichos rankeados:\n`);
  ranked.forEach((n, i) => {
    console.log(
      `  ${i + 1}. "${n.keyword}" — score ${n.score.toFixed(2)} ` +
      `(demand ${n.demandScore}/10, competition ${n.competitionScore}/10, avg $${n.avgPrice.toFixed(2)})`
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
