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
import { fetchPinterestSignals } from "./research/pinterest-source.js";
import { apifyEnabled, APIFY_OFF_LABEL } from "./lib/apify.js";
import { discoverNiches, selectDiscoveredNiches } from "./research/discovery.js";
import {
  preResearchGuard,
  hasMarketplaceSignal,
  qualifyNiche,
  pinterestStatusLabel,
} from "./research/niche-filter.js";
import { askApproval } from "./lib/approval.js";
import { analyzeNiche, rankNiches } from "./research/niche-analyzer.js";
import { generateNicheDesigns } from "./generator/run.js";
import { validateDesigns, printValidationSummary, toReviewCount } from "./validator/run.js";
import type { ValidationStats } from "./validator/run.js";
import { cleanupAssets } from "./lib/cleanup.js";
import { maybeClearApproved } from "./lib/approved-gate.js";
import { budgetReport, estimateCost, remainingUsd, budgetEnabled, BudgetExceededError } from "./lib/budget.js";
import { publishApproved } from "./publisher/index.js";
import type { ProductType, DesignMetadata, NicheContext } from "./generator/types.js";
import type { NicheAnalysis, NicheData } from "./research/types.js";
import { mkdirSync } from "fs";
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

  // Shared selection gate — identical prompt/parsing as `pnpm discover`.
  const selected = await selectDiscoveredNiches(
    `Discovery encontró ${discovered.length} nichos para ${config.market.audience}. ¿Cuál procesamos ahora?`,
    discovered
  );

  if (selected.length === 0) {
    console.log("\n⏹  Pipeline cancelado por el usuario en discovery.");
    return [];
  }
  return selected.map((n) => n.keyword);
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

    // Checkpoint 1 (shared): product coherence — free guard before any API spend.
    const guard = preResearchGuard(keyword);
    if (!guard.ok) {
      console.log(`  ⊘ "${keyword}" — descartado: ${guard.reason}`);
      continue;
    }

    process.stdout.write(`  Marketplace "${keyword}"... `);
    const marketplace = await fetchMarketplaceSignals(keyword);
    console.log(
      apifyEnabled()
        ? `source=${marketplace.source}, listings=${marketplace.listingCount ?? "?"}`
        : APIFY_OFF_LABEL
    );

    // Checkpoint 2 (shared): marketplace presence.
    if (!hasMarketplaceSignal(marketplace)) {
      console.log(`    → sin señal de marketplace, saltado`);
      continue;
    }

    process.stdout.write(`  Pinterest "${keyword}"... `);
    const pinterest = await fetchPinterestSignals(keyword);
    console.log(pinterestStatusLabel(pinterest));

    const data: NicheData = { keyword, geo: config.research.geo, marketplace, pinterest };
    marketplaceByKeyword.set(keyword, marketplace);

    process.stdout.write(`  Analizando con Gemini... `);
    try {
      const analysis = await analyzeNiche(data);
      console.log(`score=${analysis.score.toFixed(2)}`);

      // Checkpoint 3 (shared): demand + visibility qualification.
      const q = qualifyNiche(analysis);
      if (!q.ok) {
        console.log(`    → ${q.reason}, descartado`);
      } else {
        allAnalyses.push(analysis);
        saveNicheAnalysis(keyword, analysis, analysis);
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

// ── Confirmation gate (before the expensive generation step) ──────────────────

async function confirmGeneration(niches: NicheAnalysis[]): Promise<NicheAnalysis[]> {
  console.log(`\n🔎 [1.5/6] Confirmación pre-generación — ${niches.length} nicho(s) calificado(s)`);

  const options = niches.map((n) => ({
    label: n.keyword,
    detail: [
      `score=${n.score.toFixed(2)}`,
      `demand=${n.demandScore}/10`,
      `competition=${n.competitionScore}/10`,
      n.pinterestScore > 0 ? `pinterest=${n.pinterestScore}/10` : "pinterest=n/a",
      `~${config.generation.designs_per_niche * config.generation.variations_per_design} imágenes`,
    ].join(" · "),
  }));

  // Budget preflight. This used to price the images only, so the number shown at the
  // approval gate was the floor, not the cost: every design also gets a Vision call, and
  // with auto_regenerate a rejected one is re-imaged AND re-validated up to the cap.
  if (budgetEnabled()) {
    const totalImages =
      niches.length * config.generation.designs_per_niche * config.generation.variations_per_design;
    const regensPerDesign = config.validator.auto_regenerate ? config.validator.max_regenerations : 0;
    const worstCaseImages = totalImages * (1 + regensPerDesign);
    const worstCaseVision = worstCaseImages; // one validation per image produced

    const estCost = estimateCost("image", totalImages) + estimateCost("vision", totalImages);
    const worstCost = estimateCost("image", worstCaseImages) + estimateCost("vision", worstCaseVision);
    const headroom = remainingUsd();
    console.log(
      `  💰 Estimado: ${totalImages} imágenes + ${totalImages} validaciones ≈ $${estCost.toFixed(2)}` +
        (regensPerDesign > 0
          ? ` · peor caso con ${regensPerDesign} regeneración(es)/diseño ≈ $${worstCost.toFixed(2)}`
          : "") +
        ` (disponible este run: $${headroom.toFixed(2)})`
    );
    if (worstCost > headroom && estCost <= headroom) {
      console.log(
        `  ⚠️  El caso base entra, pero las regeneraciones pueden agotar el tope a mitad del run.`
      );
    }
    if (estCost > headroom) {
      console.log(
        `  ⚠️  La estimación supera el tope del run — la generación se cortará sola al llegar al límite. ` +
          `Bajá nichos/designs_per_niche o subí budget.max_usd_per_run en config.yaml.`
      );
    }
  }

  const choice = await askApproval(
    `Generar diseños para estos nichos? (la generación de imágenes es el paso costoso)`,
    options
  );

  if (choice.kind === "cancel") return [];
  if (choice.kind === "all") return niches;
  return choice.indices.map((i) => niches[i]).filter((n): n is NicheAnalysis => n != null);
}

// ── Phase 2: Generation ───────────────────────────────────────────────────────

async function runGeneration(niches: NicheAnalysis[]): Promise<DesignMetadata[]> {
  console.log(`\n🎨 [2/6] Generación — ${niches.length} nichos`);
  const products = config.generation.products as ProductType[];
  const allMeta: DesignMetadata[] = [];

  for (const niche of niches) {
    // Shared generation engine — same as `pnpm generate`. Pipeline injects its
    // SQLite persistence + recent-generation dedup via hooks.
    const generated = await generateNicheDesigns({
      niche: niche.keyword,
      ideas: niche.designIdeas,
      products,
      maxDesigns: config.generation.designs_per_niche,
      outputDir: getOutputDir(niche.keyword),
      nicheContext: buildNicheContext(niche),
      shouldSkip: (kw, concept, product) =>
        wasDesignGeneratedRecently(kw, concept, product, 14),
      onPersist: (meta, metaPath) => saveDesign(meta, metaPath),
    });
    allMeta.push(...generated);
  }

  console.log(`\n  ✅ ${allMeta.length} diseños generados`);
  return allMeta;
}

// ── Phase 3: AI Validation ────────────────────────────────────────────────────

async function runValidation(designs: DesignMetadata[]): Promise<ValidationStats> {
  console.log(
    `\n🧠 [3/6] Validación IA — ${designs.length} diseños [modelo=${config.validator.vision_model}, auto_approve=${config.validator.auto_approve_passing}, auto_regen=${config.validator.auto_regenerate}]`
  );

  // Shared engine — same routing as `pnpm validate`. Pipeline is non-interactive
  // for rejections: with auto_regenerate off, rejections are marked terminal.
  const stats = await validateDesigns(designs, { interactive: false });

  printValidationSummary(stats);
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

  // Designs in approved/ from previous runs are already uploaded to Printify; ask
  // whether to wipe them before starting (safe default: keep).
  await maybeClearApproved();

  // Prune old regenerable assets (output/ images, stale approved designs) to the last
  // `keep_runs` runs before generating more. Published artwork lives on Printify.
  if (config.cleanup.enabled) {
    const { removed } = cleanupAssets(config.cleanup.keep_runs);
    if (removed.length > 0) {
      console.log(`🧹 Limpieza: ${removed.length} carpetas antiguas borradas (keep_runs=${config.cleanup.keep_runs})`);
    }
  }

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
      console.log("\n⚠️  Sin nichos calificados. Ajusta min_demand_score / min_visibility_score en config.yaml\n");
      finishPipelineRun(runId, stats);
      return;
    }

    // Confirmation gate — image generation is the expensive step. Show the qualified
    // niches with their scores and let the user drop any before spending on Gemini images.
    const confirmed = await confirmGeneration(niches);
    if (confirmed.length === 0) {
      console.log("\n⏹  Generación cancelada por el usuario.\n");
      finishPipelineRun(runId, stats);
      return;
    }

    const designs = await runGeneration(confirmed);
    stats.designsGenerated = designs.length;

    const valStats = await runValidation(designs);
    const toReview = toReviewCount(valStats);

    if (toReview > 0) {
      // Only borderline / force-approved designs need human eyes now.
      await runPause(niches, toReview);
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
    console.log(`   ${budgetReport()}`);
    console.log();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Budget abort is an intentional stop, not a crash — record it, report spend, exit clean.
    if (err instanceof BudgetExceededError) {
      finishPipelineRun(runId, { ...stats, error: msg });
      console.log(`\n⛔ ${msg}`);
      console.log(`   ${budgetReport()}`);
      console.log("   Run detenido por el guard de presupuesto. Ajustá budget.max_usd_per_run en config.yaml.\n");
      return;
    }

    await notifyError("pipeline", msg);
    finishPipelineRun(runId, { ...stats, error: msg });
    console.error("\n❌ Pipeline failed:", msg);
    process.exit(1);
  }
}

main().catch(console.error);
