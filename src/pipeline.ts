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
import { fetchMarketplaceSignals } from "./research/apify-source.js";
import { discoverNiches } from "./research/discovery.js";
import { askApproval } from "./lib/approval.js";
import { analyzeNiche, rankNiches } from "./research/niche-analyzer.js";
import { generateAllVariations } from "./generator/image-generator.js";
import { postProcess } from "./generator/post-processor.js";
import { buildValidatorPrompt, normalizeValidation } from "./validator/criteria.js";
import { persistApprovedOrBorderline, handleRejection } from "./validator/loop-control.js";
import { analyzeImage } from "./lib/gemini.js";
import { getShops, uploadImageBase64, createProduct } from "./lib/printify.js";
import { generateSEO } from "./publisher/seo.js";
import { calculatePrice } from "./publisher/pricing.js";
import { BLUEPRINT_MAP } from "./publisher/blueprint-map.js";
import { writeEtsyPack, type EtsyPackEntry } from "./publisher/etsy-pack.js";
import type { ProductType, DesignMetadata, NicheContext, ValidationResult } from "./generator/types.js";
import type { NicheAnalysis, NicheData } from "./research/types.js";
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

// ── Phase 0: Discovery (only when auto_discover=true) ─────────────────────────

async function runDiscovery(): Promise<string[]> {
  if (!config.research.auto_discover) {
    return config.research.keywords_seed;
  }

  console.log("\n🔍 [0/6] Discovery autónoma de nichos");
  const discovered = await discoverNiches();
  if (discovered.length === 0) {
    console.error("  ❌ Discovery no encontró candidatos.");
    return [];
  }

  const options = discovered.map((n) => ({
    label: n.keyword,
    detail: `demand≈${n.expectedDemand}/10 · sample=${n.sampledListings} · ${n.avgPrice !== null ? "$" + n.avgPrice.toFixed(2) : "$?"} · ${n.rationale}`,
  }));

  const choice = await askApproval(
    `Discovery encontró ${discovered.length} nichos para ${config.market.audience}. ¿Cuáles procesamos?`,
    options
  );

  if (choice.kind === "cancel") {
    console.log("\n⏹  Pipeline cancelado por el usuario en discovery.");
    return [];
  }
  if (choice.kind === "all") return discovered.map((n) => n.keyword);
  return choice.indices.map((i) => discovered[i]?.keyword).filter((k): k is string => !!k);
}

// ── Phase 1: Research ─────────────────────────────────────────────────────────

async function runResearch(seeds: string[]): Promise<NicheAnalysis[]> {
  console.log(`\n📥 [1/6] Research — ${seeds.length} seeds [market=${config.market.country}]`);

  const allAnalyses: NicheAnalysis[] = [];
  // Snapshot of the raw marketplace signals so we can build NicheContext later
  const marketplaceByKeyword = new Map<string, NicheData["marketplace"]>();

  for (const keyword of seeds) {
    if (wasNicheResearchedRecently(keyword, 7)) {
      console.log(`  ⏭  "${keyword}" — investigado hace menos de 7 días, omitiendo`);
      continue;
    }

    process.stdout.write(`  Apify marketplace "${keyword}"... `);
    const marketplace = await fetchMarketplaceSignals(keyword);
    console.log(`source=${marketplace.source}, listings=${marketplace.listingCount ?? "?"}`);

    if (marketplace.source === "none" && marketplace.listingCount === null) {
      console.log(`    → sin señal de marketplace, saltado`);
      continue;
    }

    const data: NicheData = { keyword, geo: config.research.geo, marketplace };
    marketplaceByKeyword.set(keyword, marketplace);

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
  // Stash the marketplace data on the analysis (cheap, non-destructive) so
  // generation can build NicheContext without re-querying.
  for (const a of ranked) {
    const m = marketplaceByKeyword.get(a.keyword);
    if (m) (a as NicheAnalysis & { __marketplace?: typeof m }).__marketplace = m;
  }
  console.log(`\n  ✅ ${ranked.length} nichos calificados`);
  return ranked;
}

function buildNicheContext(n: NicheAnalysis): NicheContext {
  const m = (n as NicheAnalysis & { __marketplace?: { titles?: string[]; topTags?: string[] } }).__marketplace;
  return {
    keyword: n.keyword,
    demandScore: n.demandScore,
    competitionScore: n.competitionScore,
    topTitles: m?.titles ?? [],
    topTags: m?.topTags ?? n.seoKeywords ?? [],
    avgPrice: n.avgPrice,
    trendDirection: "stable",
    marketplaceSource: n.marketplaceSource,
  };
}

// ── Phase 2: Generation ───────────────────────────────────────────────────────

async function runGeneration(niches: NicheAnalysis[]): Promise<DesignMetadata[]> {
  console.log(`\n🎨 [2/6] Generación — ${niches.length} nichos`);
  const allMeta: DesignMetadata[] = [];
  let designIndex = 0;

  for (const niche of niches) {
    const outputDir = getOutputDir(niche.keyword);
    const products = config.generation.products as ProductType[];
    const ideas = niche.designIdeas
      .filter((idea) => products.includes(idea.targetProduct))
      .slice(0, config.generation.designs_per_niche);
    const nicheContext = buildNicheContext(niche);

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
        nicheContext,
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

// ── Phase 3: AI Validation ────────────────────────────────────────────────────

async function runValidation(designs: DesignMetadata[]): Promise<{
  passed: number;
  rejected: number;
  forced: number;
  regenerated: number;
}> {
  console.log(`\n🧠 [3/6] Validación IA — ${designs.length} diseños [modelo=${config.validator.vision_model}]`);

  const stats = { passed: 0, rejected: 0, forced: 0, regenerated: 0 };
  const queue = designs.filter((d) => d.status === "pending-validation");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  while (queue.length > 0) {
    const meta = queue.shift() as DesignMetadata;
    process.stdout.write(`  ${meta.id}... `);

    let verdict: ValidationResult;
    try {
      const buf = readFileSync(meta.files.original);
      const mimeType = meta.files.original.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const prompt = buildValidatorPrompt(
        meta.nicheContext,
        meta.concept,
        meta.style,
        meta.product,
        meta.variation
      );
      const raw = await analyzeImage<Partial<ValidationResult>>(buf.toString("base64"), mimeType, prompt);
      verdict = normalizeValidation(raw, config.validator.vision_model);
    } catch (err) {
      console.log(`ERROR (${err instanceof Error ? err.message : err}) — saltado`);
      continue;
    }

    console.log(`${verdict.verdict} (overall ${verdict.scores.overall.toFixed(1)}/10)`);

    if (verdict.verdict === "approved" || verdict.verdict === "borderline") {
      persistApprovedOrBorderline(meta, verdict);
      stats.passed++;
      continue;
    }
    // Rejected — interactive prompt
    const action = await handleRejection(meta, verdict, rl);
    if (action.kind === "regenerate") {
      stats.regenerated++;
      queue.push(action.newDesign);
    } else if (action.kind === "force-approve") {
      stats.forced++;
    } else {
      stats.rejected++;
    }
  }

  rl.close();
  console.log(`  ✅ pasan a review: ${stats.passed + stats.forced} | rechazados: ${stats.rejected} | regenerados: ${stats.regenerated}`);
  return stats;
}

// ── Phase 4: Manual Pause ─────────────────────────────────────────────────────

async function runPause(niches: NicheAnalysis[], totalDesigns: number): Promise<void> {
  console.log("\n⏸  [4/6] Revisión manual requerida");
  console.log("─".repeat(60));

  if (config.pipeline.notify_telegram) {
    await notifyDesignsReady(niches.map((n) => n.keyword), totalDesigns);
    console.log("  📱 Notificación enviada por Telegram");
  }

  console.log(`\n  ${totalDesigns} diseños listos en output/`);
  console.log("  Ejecuta en otra terminal: pnpm review\n");

  await waitForEnter("  Presiona ENTER cuando hayas terminado la revisión...");
}

// ── Phase 5: Publish ──────────────────────────────────────────────────────────

async function runPublish(): Promise<number> {
  console.log("\n🚀 [5/6] Publicación (Printify DRAFT + Etsy pack)");

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
  console.log(`   Mode: ${config.research.auto_discover ? "auto-discovery" : "manual seeds (" + config.research.keywords_seed.join(", ") + ")"}`);
  console.log("═".repeat(60));

  const seeds = await runDiscovery();
  if (seeds.length === 0) {
    console.log("\n⚠️  Sin seeds tras discovery. Aborta.\n");
    return;
  }

  const runId = startPipelineRun("full", seeds);
  const stats = { nichesFound: 0, designsGenerated: 0, designsPublished: 0 };

  try {
    const niches = await runResearch(seeds);
    stats.nichesFound = niches.length;

    if (niches.length === 0) {
      console.log("\n⚠️  Sin nichos calificados. Ajusta min_demand_score en config.yaml\n");
      finishPipelineRun(runId, stats);
      return;
    }

    const designs = await runGeneration(niches);
    stats.designsGenerated = designs.length;

    const valStats = await runValidation(designs);
    const toReview = valStats.passed + valStats.forced;

    await runPause(niches, toReview);

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
