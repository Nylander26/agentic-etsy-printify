/**
 * Semana 3 entregable — módulo de generación.
 * Uso: pnpm generate --niche "funny cat quotes" --products tshirt,mug,poster
 *      pnpm generate --from-research          # usa el último research-results/*.json
 */
import { mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { generateNicheDesigns } from "./run.js";
import { budgetReport } from "../lib/budget.js";
import { getConfig } from "../lib/config.js";
import type { ProductType, DesignMetadata, NicheContext } from "./types.js";
import type { ResearchResult, NicheAnalysis, DesignIdea } from "../research/types.js";

function nicheContextFromAnalysis(n: NicheAnalysis): NicheContext {
  return {
    keyword: n.keyword,
    demandScore: n.demandScore,
    competitionScore: n.competitionScore,
    topTitles: [],   // niche-analyzer doesn't currently surface raw titles; left empty here
    topTags: n.seoKeywords ?? [],
    avgPrice: n.avgPrice,
    trendDirection: "stable",  // populated below when available
    marketplaceSource: n.marketplaceSource,
  };
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(): {
  niche: string | null;
  products: ProductType[];
  fromResearch: boolean;
  maxDesigns: number;
} {
  const args = process.argv;

  const nicheIdx = args.indexOf("--niche");
  const niche = nicheIdx !== -1 ? (args[nicheIdx + 1] ?? null) : null;

  const productsIdx = args.indexOf("--products");
  const productsRaw = productsIdx !== -1 ? (args[productsIdx + 1] ?? "") : "tshirt,mug,poster";
  const products = productsRaw.split(",").map((p) => p.trim()) as ProductType[];

  const fromResearch = args.includes("--from-research");

  // Default comes from config, NOT a literal. `pnpm pipeline` passes
  // generation.designs_per_niche explicitly, so before this the standalone CLI was the
  // only path that ignored it: on 2026-08-14 `pnpm generate --from-research` burned 15
  // images for a niche configured at 3 designs, because research had returned 5 ideas
  // and the hardcoded 5 let all of them through. Both entry points read the same knob now.
  const maxIdx = args.indexOf("--max");
  const maxDesigns =
    maxIdx !== -1 ? Number(args[maxIdx + 1]) : getConfig().generation.designs_per_niche;

  return { niche, products, fromResearch, maxDesigns };
}

// ── Research loader ───────────────────────────────────────────────────────────

function loadLatestResearch(): ResearchResult | null {
  try {
    const files = readdirSync("research-results")
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    return JSON.parse(
      readFileSync(join("research-results", files[0] as string), "utf-8")
    ) as ResearchResult;
  } catch {
    return null;
  }
}

// ── Manual niche → design ideas ───────────────────────────────────────────────

function manualDesignIdeas(niche: string, products: ProductType[]): DesignIdea[] {
  // Generates placeholder ideas when not using research output
  return products.flatMap((product) => [
    { concept: `${niche} — minimalist text design`, style: "minimalist, bold typography", targetProduct: product },
    { concept: `${niche} — cute illustration`, style: "flat design, pastel colors", targetProduct: product },
  ]);
}

// ── Output dir helpers ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

function getOutputDir(niche: string): string {
  const date = new Date().toISOString().split("T")[0] as string;
  const dir = join("output", date, slugify(niche));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processNiche(
  niche: string,
  ideas: DesignIdea[],
  products: ProductType[],
  maxDesigns: number,
  nicheContext?: NicheContext
): Promise<DesignMetadata[]> {
  // Standalone generation: no SQLite persistence, no dedup hooks — just generate.
  return generateNicheDesigns({
    niche,
    ideas,
    products,
    maxDesigns,
    outputDir: getOutputDir(niche),
    ...(nicheContext ? { nicheContext } : {}),
  });
}

async function main() {
  const { niche, products, fromResearch, maxDesigns } = parseArgs();

  console.log("\n🎨 Generator starting...\n" + "─".repeat(60));

  let nichesToProcess: Array<{
    niche: string;
    ideas: DesignIdea[];
    context?: NicheContext;
  }> = [];

  if (fromResearch) {
    const research = loadLatestResearch();
    if (!research) {
      console.error("No research results found. Run: pnpm research --seeds \"...\"\n");
      process.exit(1);
    }
    console.log(`Using research from: ${research.date} (${research.topNiches.length} niches)`);
    nichesToProcess = research.topNiches.map((n: NicheAnalysis) => ({
      niche: n.keyword,
      ideas: n.designIdeas,
      context: nicheContextFromAnalysis(n),
    }));
  } else if (niche) {
    nichesToProcess = [{ niche, ideas: manualDesignIdeas(niche, products) }];
  } else {
    console.error('Specify --niche "..." or --from-research');
    process.exit(1);
  }

  const allGenerated: DesignMetadata[] = [];

  for (const { niche: n, ideas, context } of nichesToProcess) {
    const generated = await processNiche(n, ideas, products, maxDesigns, context);
    allGenerated.push(...generated);
  }

  // Summary
  const pending = allGenerated.filter((m) => m.status === "pending-validation").length;
  console.log("\n" + "─".repeat(60));

  if (pending === 0) {
    console.log("\n❌ No se generó ningún diseño. Revisa los errores arriba.\n");
    process.exit(1);
  }

  console.log(`\n✅ Generación completada:`);
  console.log(`   Total diseños: ${allGenerated.length}`);
  console.log(`   Pendientes de validación IA: ${pending}`);
  console.log(`   ${budgetReport()}`);
  console.log(`\n   Siguiente paso: pnpm validate\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Generator failed:", err);
    process.exit(1);
  });
