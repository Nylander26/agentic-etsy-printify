/**
 * Semana 5 entregable — orquestador completo.
 * Uso: pnpm pipeline
 *
 * Flujo:
 *   1. Research (automático) → guarda nichos en SQLite + research-results/
 *   2. Generación (automático) → crea diseños en output/ + registra en SQLite
 *   3. PAUSA → notifica Telegram, espera que ejecutes `pnpm review`
 *   4. Publicación → publica los aprobados en Etsy vía Printify
 */
import * as readline from "readline";
import { getConfig } from "./lib/config.js";
import { notifyDesignsReady, notifyPublished, notifyError } from "./lib/telegram.js";
import {
  startPipelineRun,
  finishPipelineRun,
  wasNicheResearchedRecently,
  saveNicheAnalysis,
  wasDesignGeneratedRecently,
  saveDesign,
  savePublishedProduct,
} from "./lib/db.js";
import { searchNiche } from "./research/trends-source.js";
import { analyzeNiche, rankNiches } from "./research/niche-analyzer.js";
import { generateAllVariations } from "./generator/image-generator.js";
import { postProcess } from "./generator/post-processor.js";
import { getShops, uploadImageBase64, createProduct } from "./lib/printify.js";
import { generateSEO } from "./publisher/seo.js";
import { calculatePrice } from "./publisher/pricing.js";
import { BLUEPRINT_MAP } from "./publisher/blueprint-map.js";
import { writeEtsyPack, type EtsyPackEntry } from "./publisher/etsy-pack.js";
import type { ProductType, DesignMetadata } from "./generator/types.js";
import type { NicheAnalysis } from "./research/types.js";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const config = getConfig();

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

function getOutputDir(niche: string): string {
  const date = new Date().toISOString().split("T")[0] as string;
  const dir = join("output", date, slugify(niche));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

function findApprovedDesigns(): Array<{ meta: DesignMetadata; metaPath: string }> {
  const results: Array<{ meta: DesignMetadata; metaPath: string }> = [];
  function walk(dir: string) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === "metadata.json") {
        try {
          const meta = JSON.parse(readFileSync(full, "utf-8")) as DesignMetadata;
          if (meta.status === "approved") results.push({ meta, metaPath: full });
        } catch { /* skip */ }
      } else {
        try { if (readdirSync(full)) walk(full); } catch { /* not dir */ }
      }
    }
  }
  walk("approved");
  return results;
}

// ── Phase 1: Research ─────────────────────────────────────────────────────────

async function runResearch(): Promise<NicheAnalysis[]> {
  const seeds = config.research.keywords_seed;
  console.log(`\n📥 [1/4] Research — ${seeds.length} seeds`);

  const allAnalyses: NicheAnalysis[] = [];

  for (const keyword of seeds) {
    if (wasNicheResearchedRecently(keyword, 7)) {
      console.log(`  ⏭  "${keyword}" — investigado hace menos de 7 días, omitiendo`);
      continue;
    }

    process.stdout.write(`  Trends "${keyword}"... `);
    const data = await searchNiche(keyword, config.research.geo);
    console.log(`avg=${data.avgInterest.toFixed(0)}, trend=${data.trend}`);

    if (data.samplePoints === 0) continue;

    process.stdout.write(`  Analizando con Gemini... `);
    try {
      const analysis = await analyzeNiche(data);
      console.log(`score=${analysis.score.toFixed(2)}`);

      if (analysis.demandScore >= config.research.min_demand_score) {
        allAnalyses.push(analysis);
        saveNicheAnalysis(keyword, analysis, analysis);
      } else {
        console.log(`    → demand score ${analysis.demandScore} < ${config.research.min_demand_score}, descartado`);
      }
    } catch (err) {
      console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  const ranked = rankNiches(allAnalyses).slice(0, config.research.max_niches);
  console.log(`\n  ✅ ${ranked.length} nichos calificados`);
  return ranked;
}

// ── Phase 2: Generation ───────────────────────────────────────────────────────

async function runGeneration(niches: NicheAnalysis[]): Promise<DesignMetadata[]> {
  console.log(`\n🎨 [2/4] Generación — ${niches.length} nichos`);
  const allMeta: DesignMetadata[] = [];
  let designIndex = 0;

  for (const niche of niches) {
    const outputDir = getOutputDir(niche.keyword);
    const products = config.generation.products as ProductType[];
    const ideas = niche.designIdeas
      .filter((idea) => products.includes(idea.targetProduct))
      .slice(0, config.generation.designs_per_niche);

    console.log(`\n  Nicho: "${niche.keyword}" — ${ideas.length} ideas`);

    for (const idea of ideas) {
      if (wasDesignGeneratedRecently(niche.keyword, idea.concept, idea.targetProduct, 14)) {
        console.log(`    ⏭  "${idea.concept}" (${idea.targetProduct}) — ya generado recientemente`);
        continue;
      }

      designIndex++;
      console.log(`    [${designIndex}] "${idea.concept}" → ${idea.targetProduct}`);

      const generated = await generateAllVariations({
        niche: niche.keyword,
        concept: idea.concept,
        style: idea.style,
        product: idea.targetProduct,
        outputDir,
        index: designIndex,
      });

      for (const meta of generated) {
        try {
          const pp = await postProcess(meta);
          if (pp.noBgPath) {
            meta.files.noBg = pp.noBgPath;
            const dir = join(outputDir, meta.id);
            writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta, null, 2));
          }
        } catch { /* keep design even without post-processing */ }

        saveDesign(meta, join(outputDir, meta.id, "metadata.json"));
        allMeta.push(meta);
      }
    }
  }

  console.log(`\n  ✅ ${allMeta.length} diseños generados`);
  return allMeta;
}

// ── Phase 3: Pause ────────────────────────────────────────────────────────────

async function runPause(niches: NicheAnalysis[], totalDesigns: number): Promise<void> {
  console.log("\n⏸  [3/4] Revisión manual requerida");
  console.log("─".repeat(60));

  if (config.pipeline.notify_telegram) {
    await notifyDesignsReady(niches.map((n) => n.keyword), totalDesigns);
    console.log("  📱 Notificación enviada por Telegram");
  }

  console.log(`\n  ${totalDesigns} diseños listos en output/`);
  console.log("  Ejecuta en otra terminal: pnpm review\n");

  await waitForEnter("  Presiona ENTER cuando hayas terminado la revisión...");
}

// ── Phase 4: Publish ──────────────────────────────────────────────────────────

async function runPublish(): Promise<number> {
  console.log("\n🚀 [4/4] Publicación (Printify DRAFT + Etsy pack)");

  const approved = findApprovedDesigns();
  const toPublish = approved.slice(0, config.publishing.max_publish_per_run);

  if (toPublish.length === 0) {
    console.log("  No hay diseños aprobados — saltando publicación");
    return 0;
  }

  const shops = await getShops();
  const shop = shops[0];
  if (!shop) throw new Error("No Printify shop found");

  console.log(`  Creando ${toPublish.length} drafts en "${shop.title}"...`);
  let drafted = 0;
  const packEntries: EtsyPackEntry[] = [];

  for (const { meta, metaPath } of toPublish) {
    try {
      const blueprint = BLUEPRINT_MAP[meta.product];
      const imagePath = meta.product === "tshirt" && meta.files.noBg
        ? meta.files.noBg : meta.files.original;

      const base64 = readFileSync(imagePath).toString("base64");
      const uploaded = await uploadImageBase64(`${meta.id}.png`, base64);

      const pricing = calculatePrice(meta.product, { marginPercent: config.publishing.margin_percent });
      const seo = await generateSEO(meta, [], pricing.suggestedPrice);
      const priceInCents = Math.round(pricing.suggestedPrice * 100);

      const product = await createProduct({
        shopId: shop.id,
        title: seo.title,
        description: seo.description,
        blueprintId: blueprint.blueprintId,
        printProviderId: blueprint.printProviderId,
        variants: blueprint.defaultVariants.map((v) => ({
          id: v.id, price: priceInCents, is_enabled: true,
        })),
        printAreas: [{
          variant_ids: blueprint.defaultVariants.map((v) => v.id),
          placeholders: [{
            position: blueprint.printPosition,
            images: [{ id: uploaded.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
          }],
        }],
      });

      // Product remains as DRAFT in Printify — user publishes manually
      savePublishedProduct(meta.id, product.id, seo.title, pricing.suggestedPrice);

      const updatedMeta = { ...meta, printifyProductId: product.id, draftedAt: new Date().toISOString() };
      writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2));

      packEntries.push({
        designId: meta.id,
        niche: meta.niche,
        product: meta.product,
        printifyProductId: product.id,
        title: seo.title,
        description: seo.description,
        tags: seo.tags ?? [],
        suggestedPrice: pricing.suggestedPrice,
      });

      console.log(`  ✅ DRAFT "${seo.title.slice(0, 50)}..."`);
      drafted++;
    } catch (err) {
      console.error(`  ❌ ${meta.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (packEntries.length > 0) {
    const packPath = writeEtsyPack(packEntries);
    console.log(`\n  📦 Etsy pack: ${packPath}`);
    console.log(`  → Publica manualmente desde Printify dashboard ("Publish to Etsy")`);
    console.log(`     o usa el pack JSON para crear los listings en Etsy.`);
  }

  if (config.pipeline.notify_telegram) {
    await notifyPublished(drafted);
  }

  return drafted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔄 Pipeline iniciando...");
  console.log(`   Seeds: ${config.research.keywords_seed.join(", ")}`);
  console.log("═".repeat(60));

  const runId = startPipelineRun("full", config.research.keywords_seed);
  const stats = { nichesFound: 0, designsGenerated: 0, designsPublished: 0 };

  try {
    const niches = await runResearch();
    stats.nichesFound = niches.length;

    if (niches.length === 0) {
      console.log("\n⚠️  Sin nichos calificados. Ajusta min_demand_score en config.yaml\n");
      finishPipelineRun(runId, stats);
      return;
    }

    const designs = await runGeneration(niches);
    stats.designsGenerated = designs.length;

    await runPause(niches, designs.length);

    const published = await runPublish();
    stats.designsPublished = published;

    finishPipelineRun(runId, stats);

    console.log("\n" + "═".repeat(60));
    console.log("✅ Pipeline completado:");
    console.log(`   Nichos investigados: ${stats.nichesFound}`);
    console.log(`   Diseños generados:   ${stats.designsGenerated}`);
    console.log(`   Drafts en Printify:  ${stats.designsPublished}`);
    console.log();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await notifyError("pipeline", msg);
    finishPipelineRun(runId, { ...stats, error: msg });
    console.error("\n❌ Pipeline failed:", msg);
    process.exit(1);
  }
}

main().catch(console.error);
