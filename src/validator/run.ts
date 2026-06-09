/**
 * Shared validation engine — the SINGLE implementation used by BOTH the
 * standalone validator CLI (`validator/index.ts`) and the pipeline
 * (`pipeline.ts`). Neither may reimplement the verdict-routing loop.
 *
 * Routing (identical for both callers):
 *   approved + auto_approve_passing  → approved/ (skip manual review)
 *   approved (auto_approve off)       → pending-review
 *   borderline                        → pending-review
 *   rejected + auto_regenerate        → regenerate (capped) or rejected/
 *   rejected + interactive            → [R]/[S]/[F] menu
 *   rejected (CI, non-interactive)    → rejected/
 */
import { readFileSync } from "fs";
import * as readline from "readline";
import { analyzeImage } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { buildValidatorPrompt, normalizeValidation } from "./criteria.js";
import {
  handleRejection,
  persistApprovedOrBorderline,
  promoteToApproved,
  autoRegenerate,
  markRejected,
} from "./loop-control.js";
import type { DesignMetadata, ValidationResult } from "../generator/types.js";

export interface ValidationStats {
  autoApproved: number; // approved → approved/ directly (hybrid review)
  approved: number;     // approved → pending-review (auto_approve_passing = false)
  borderline: number;
  forced: number;       // force-approved → pending-review
  rejected: number;
  regenerated: number;
  skipped: number;      // CI mode rejections
  errors: number;
}

export function emptyValidationStats(): ValidationStats {
  return {
    autoApproved: 0,
    approved: 0,
    borderline: 0,
    forced: 0,
    rejected: 0,
    regenerated: 0,
    skipped: 0,
    errors: 0,
  };
}

/** Designs routed into the manual review queue. */
export function toReviewCount(s: ValidationStats): number {
  return s.approved + s.borderline + s.forced;
}

/** Run a single design through the Gemini vision rubric. */
export async function validateOne(meta: DesignMetadata): Promise<ValidationResult> {
  const prompt = buildValidatorPrompt(
    meta.nicheContext,
    meta.concept,
    meta.style,
    meta.product,
    meta.variation
  );
  const path = meta.files.original;
  const buf = readFileSync(path);
  const mimeType = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const raw = await analyzeImage<Partial<ValidationResult>>(buf.toString("base64"), mimeType, prompt);
  return normalizeValidation(raw, getConfig().validator.vision_model);
}

function printVerdict(meta: DesignMetadata, v: ValidationResult): void {
  const emoji = v.verdict === "approved" ? "✅" : v.verdict === "borderline" ? "🟡" : "❌";
  console.log(
    `  ${emoji} ${meta.id} — ${v.verdict} (overall ${v.scores.overall.toFixed(1)}/10) [${meta.product}/${meta.variation}]`
  );
}

export interface ValidateOpts {
  /** When false (CI), rejections are marked terminal instead of prompting. */
  interactive: boolean;
}

/**
 * Validate a list of designs, routing each per config. Regenerations are pushed
 * back onto the queue and re-validated. Returns granular stats.
 */
export async function validateDesigns(
  designs: DesignMetadata[],
  opts: ValidateOpts
): Promise<ValidationStats> {
  const cfg = getConfig();
  const autoApprove = cfg.validator.auto_approve_passing;
  const autoRegen = cfg.validator.auto_regenerate;
  const stats = emptyValidationStats();

  const queue = designs.filter((d) => d.status === "pending-validation");

  // readline only when an interactive rejection menu is possible (auto_regenerate off).
  const rl =
    opts.interactive && !autoRegen
      ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
      : null;

  while (queue.length > 0) {
    const meta = queue.shift() as DesignMetadata;
    process.stdout.write(`  Evaluando ${meta.id}... `);

    let verdict: ValidationResult;
    try {
      verdict = await validateOne(meta);
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
      stats.errors++;
      continue;
    }
    console.log("");
    printVerdict(meta, verdict);

    if (verdict.verdict === "approved") {
      if (autoApprove) {
        promoteToApproved(meta, verdict);
        stats.autoApproved++;
        console.log("    → auto-aprobado, movido a approved/ (listo para publicar)");
      } else {
        persistApprovedOrBorderline(meta, verdict);
        stats.approved++;
        console.log("    → aprobado, movido a pending-review");
      }
      continue;
    }
    if (verdict.verdict === "borderline") {
      persistApprovedOrBorderline(meta, verdict);
      stats.borderline++;
      console.log("    → borderline, movido a pending-review");
      continue;
    }

    // Rejected
    if (autoRegen) {
      const newDesign = await autoRegenerate(meta, verdict);
      if (newDesign) {
        stats.regenerated++;
        queue.push(newDesign);
        console.log(`    → regenerado automáticamente: ${newDesign.id} (vuelve a validación)`);
      } else {
        markRejected(meta, verdict);
        stats.rejected++;
        console.log("    → rechazado (cap de regeneraciones alcanzado o generación falló)");
      }
      continue;
    }
    if (opts.interactive && rl) {
      const action = await handleRejection(meta, verdict, rl);
      if (action.kind === "regenerate") {
        stats.regenerated++;
        queue.push(action.newDesign);
      } else if (action.kind === "force-approve") {
        stats.forced++;
      } else {
        stats.rejected++;
      }
      continue;
    }
    // CI mode (non-interactive, auto_regenerate off)
    markRejected(meta, verdict);
    stats.skipped++;
    console.log("    → rechazado (modo CI)");
  }

  rl?.close();
  return stats;
}

/** Shared summary printer so both flows report identically. */
export function printValidationSummary(stats: ValidationStats): void {
  const autoApprove = getConfig().validator.auto_approve_passing;
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  Resumen del validador:");
  if (autoApprove) console.log(`  ⚡ Auto-aprobados → approved/: ${stats.autoApproved}`);
  else console.log(`  ✅ Aprobados → review:        ${stats.approved}`);
  console.log(`  🟡 Borderline → review:       ${stats.borderline}`);
  console.log(`  ❌ Rechazados:                ${stats.rejected}`);
  if (stats.forced > 0) console.log(`  ⚡ Force-approved → review:   ${stats.forced}`);
  console.log(`  🔄 Regenerados:               ${stats.regenerated}`);
  if (stats.skipped > 0) console.log(`  ⏭  Skipped (CI):              ${stats.skipped}`);
  if (stats.errors > 0) console.log(`  💥 Errores:                   ${stats.errors}`);
}
