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
} from "./lib/db.js";
import { fetchMarketplaceSignals } from "./research/apify-source.js";
import { discoverNiches } from "./research/discovery.js";
import { askApproval } from "./lib/approval.js";
import { analyzeNiche, rankNiches } from "./research/niche-analyzer.js";
import { generateAllVariations } from "./generator/image-generator.js";
import { postProcess } from "./generator/post-processor.js";
import { buildValidatorPrompt, normalizeValidation } from "./validator/criteria.js";
import {
  persistApprovedOrBorderline,
  handleRejection,
  promoteToApproved,
  autoRegenerate,
  markRejected,
} from "./validator/loop-control.js";
import { analyzeImage } from "./lib/gemini.js";
import { publishApproved } from "./publisher/index.js";
import type { ProductType, DesignMetadata, NicheContext, ValidationResult } from "./generator/types.js";
import type { NicheAnalysis, NicheData } from "./research/types.js";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
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
  autoApproved: number;
  toReview: number;
  rejected: number;
  regenerated: number;
}> {
  const autoApprove = config.validator.auto_approve_passing;
  const autoRegen = config.validator.auto_regenerate;
  console.log(
    `\n🧠 [3/6] Validación IA — ${designs.length} diseños [modelo=${config.validator.vision_model}, auto_approve=${autoApprove}, auto_regen=${autoRegen}]`
  );

  const stats = { autoApproved: 0, review: 0, rejected: 0, regenerated: 0 };
  const queue = designs.filter((d) => d.status === "pending-validation");

  // readline only when a rejection could need the interactive menu (auto_regenerate off)
  const rl = !autoRegen
    ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    : null;

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

    // Approved + hybrid review → straight to approved/ (skip manual review)
    if (verdict.verdict === "approved" && autoApprove) {
      promoteToApproved(meta, verdict);
      stats.autoApproved++;
      continue;
    }
    // Approved without auto-approve, or borderline → pending-review (human gate)
    if (verdict.verdict === "approved" || verdict.verdict === "borderline") {
      persistApprovedOrBorderline(meta, verdict);
      stats.review++;
      continue;
    }
    // Rejected
    if (autoRegen) {
      const newDesign = await autoRegenerate(meta, verdict);
      if (newDesign) {
        stats.regenerated++;
        queue.push(newDesign);
      } else {
        markRejected(meta, verdict);
        stats.rejected++;
      }
      continue;
    }
    if (rl) {
      const action = await handleRejection(meta, verdict, rl);
      if (action.kind === "regenerate") {
        stats.regenerated++;
        queue.push(action.newDesign);
      } else if (action.kind === "force-approve") {
        stats.review++;
      } else {
        stats.rejected++;
      }
      continue;
    }
    markRejected(meta, verdict);
    stats.rejected++;
  }

  rl?.close();
  console.log(
    `  ✅ auto-aprobados: ${stats.autoApproved} | a review: ${stats.review} | rechazados: ${stats.rejected} | regenerados: ${stats.regenerated}`
  );
  return {
    autoApproved: stats.autoApproved,
    toReview: stats.review,
    rejected: stats.rejected,
    regenerated: stats.regenerated,
  };
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

  // Delegate to the publisher's robust path: pinned/Etsy shop selection, draft-index
  // dedup, fan-out composition safety, stock reconcile + mockups. (The old bespoke
  // loop here used shops[0] — drafting into the wrong store — and hit a SQLite FK on
  // stale approved/ designs not present in the current designs table.)
  const { drafted } = await publishApproved();

  if (config.pipeline.notify_telegram && drafted > 0) {
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

    if (valStats.toReview > 0) {
      // Only borderline / force-approved designs need human eyes now.
      await runPause(niches, valStats.toReview);
    } else {
      console.log("\n⏭  [4/6] Sin diseños borderline — todo auto-aprobado, publicando directo");
      if (valStats.autoApproved === 0) {
        console.log("  ⚠️  Tampoco hubo auto-aprobados; revisa los rechazos arriba.");
      }
    }

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
