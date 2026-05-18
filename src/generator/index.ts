/**
 * Semana 3 entregable — módulo de generación.
 * Uso: pnpm generate --niche "funny cat quotes" --products tshirt,mug,poster
 *      pnpm generate --from-research          # usa el último research-results/*.json
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generateAllVariations } from "./image-generator.js";
import { postProcess } from "./post-processor.js";
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

  const maxIdx = args.indexOf("--max");
  const maxDesigns = maxIdx !== -1 ? Number(args[maxIdx + 1] ?? 5) : 5;

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
  const outputDir = getOutputDir(niche);
  const allMetadata: DesignMetadata[] = [];
  let designIndex = 0;

  // Filter ideas by requested products
  const filtered = ideas.filter((idea) => products.includes(idea.targetProduct));
  const toGenerate = filtered.slice(0, maxDesigns);

  console.log(`\n  Nicho: "${niche}" — ${toGenerate.length} conceptos × 3 variaciones`);

  for (const idea of toGenerate) {
    designIndex++;
    console.log(`\n  [${designIndex}/${toGenerate.length}] "${idea.concept}" → ${idea.targetProduct}`);

    const generated = await generateAllVariations({
      niche,
      concept: idea.concept,
      style: idea.style,
      product: idea.targetProduct,
      outputDir,
      index: designIndex,
      ...(nicheContext ? { nicheContext } : {}),
    });

    // Post-process each generated design
    for (const meta of generated) {
      try {
        const pp = await postProcess(meta);
        // Point original at the Printify-ready resized image (PNG)
        meta.files.original = pp.resizedOriginalPath;
        if (pp.noBgPath) meta.files.noBg = pp.noBgPath;
        const dir = join(outputDir, meta.id);
        writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta, null, 2));
        allMetadata.push(meta);
      } catch (err) {
        console.error(`      Post-process error: ${err instanceof Error ? err.message : err}`);
        allMetadata.push(meta); // keep it even without post-processing
      }
    }
  }

  return allMetadata;
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
  console.log(`\n   Siguiente paso: pnpm validate\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Generator failed:", err);
    process.exit(1);
  });
