/**
 * Shared generation engine — the SINGLE implementation used by BOTH the
 * standalone generator CLI (`generator/index.ts`) and the pipeline
 * (`pipeline.ts`). Neither may reimplement the generate→post-process→persist loop.
 *
 * Pipeline-specific behavior (SQLite persistence, recent-generation dedup) is
 * injected via optional hooks so this module stays free of DB concerns.
 */
import { writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { generateAllVariations } from "./image-generator.js";
import { postProcess } from "./post-processor.js";
import { getConfig } from "../lib/config.js";
import { perceptualHash } from "../lib/phash.js";
import { findSimilar, recordHash } from "../lib/phash-index.js";
import { BudgetExceededError } from "../lib/budget.js";
import type { ProductType, DesignMetadata, NicheContext } from "./types.js";
import type { DesignIdea } from "../research/types.js";

export interface GenerateNicheParams {
  niche: string;
  ideas: DesignIdea[];
  products: ProductType[];
  maxDesigns: number;
  outputDir: string;
  nicheContext?: NicheContext;
  /** Return true to skip an idea (pipeline injects recent-generation dedup). */
  shouldSkip?: (niche: string, concept: string, product: ProductType) => boolean;
  /** Called after each design's metadata is written (pipeline injects SQLite save). */
  onPersist?: (meta: DesignMetadata, metadataPath: string) => void;
}

/**
 * Generate all design variations for one niche, post-process each, write
 * metadata, and return the resulting designs.
 *
 * Post-processing ALWAYS points `meta.files.original` at the resized,
 * Printify-ready image (`resizedOriginalPath`) so downstream validation and
 * publishing read the correct asset — identical in both callers.
 */
export async function generateNicheDesigns(
  p: GenerateNicheParams
): Promise<DesignMetadata[]> {
  const ideas = p.ideas
    .filter((idea) => p.products.includes(idea.targetProduct))
    .slice(0, p.maxDesigns);

  console.log(`\n  Nicho: "${p.niche}" — ${ideas.length} conceptos × variaciones`);

  const dedup = getConfig().generation.dedup_phash;
  const runDate = new Date().toISOString().slice(0, 10);

  const all: DesignMetadata[] = [];
  let designIndex = 0;

  for (const idea of ideas) {
    if (p.shouldSkip?.(p.niche, idea.concept, idea.targetProduct)) {
      console.log(`    ⏭  "${idea.concept}" (${idea.targetProduct}) — ya generado recientemente`);
      continue;
    }

    designIndex++;
    console.log(`    [${designIndex}] "${idea.concept}" → ${idea.targetProduct}`);

    let generated: DesignMetadata[];
    try {
      generated = await generateAllVariations({
        niche: p.niche,
        concept: idea.concept,
        style: idea.style,
        product: idea.targetProduct,
        outputDir: p.outputDir,
        index: designIndex,
        ...(p.nicheContext ? { nicheContext: p.nicheContext } : {}),
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.log(`    ⛔ ${err.message}\n       Detengo la generación; sigo con los ${all.length} diseños ya hechos.`);
        break;
      }
      throw err;
    }

    for (const meta of generated) {
      const designDir = join(p.outputDir, meta.id);
      const metadataPath = join(designDir, "metadata.json");

      // Perceptual-hash dedup — drop a near-identical design BEFORE post-processing,
      // validating (paid Vision call) or publishing it. Hash the raw generated image
      // (meta.files.original still points at it here, pre-resize).
      if (dedup.enabled) {
        try {
          const hash = await perceptualHash(readFileSync(meta.files.original));
          const dup = findSimilar(hash, dedup.max_distance, dedup.compare_runs);
          if (dup) {
            console.log(`      ⊘ dup perceptual (dist=${dup.distance} vs "${dup.designId}") — descartado`);
            rmSync(designDir, { recursive: true, force: true });
            continue;
          }
          recordHash({ hash, designId: meta.id, date: runDate }, dedup.compare_runs);
        } catch (err) {
          // Hashing must never block generation — on error, keep the design.
          console.error(`      pHash error (sigo igual): ${err instanceof Error ? err.message : err}`);
        }
      }

      try {
        const pp = await postProcess(meta);
        // Point original at the Printify-ready resized image (consistent for all callers).
        meta.files.original = pp.resizedOriginalPath;
        if (pp.noBgPath) meta.files.noBg = pp.noBgPath;
        writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
      } catch (err) {
        console.error(`      Post-process error: ${err instanceof Error ? err.message : err}`);
        // Keep the design even without post-processing — metadata already written by generator.
      }

      p.onPersist?.(meta, metadataPath);
      all.push(meta);
    }
  }

  return all;
}
