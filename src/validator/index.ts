/**
 * Design validator agent — Semana 4 (between generator and reviewer).
 *
 * Scans all `output/**\/metadata.json` files in `pending-validation` state,
 * runs each through a Gemini vision call with the niche-aware rubric defined
 * in `criteria.ts`, then routes the design:
 *   - approved | borderline  → status `pending-review` (manual review takes over)
 *   - rejected               → interactive menu (regenerate / skip / force)
 *
 * Usage:
 *   pnpm validate                      # all pending-validation designs
 *   pnpm validate --design <id>        # only the specified design
 *   pnpm validate --no-interactive     # auto-skip rejections (CI mode)
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as readline from "readline";
import { analyzeImage } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { buildValidatorPrompt, normalizeValidation } from "./criteria.js";
import {
  handleRejection,
  persistApprovedOrBorderline,
} from "./loop-control.js";
import type { DesignMetadata, ValidationResult } from "../generator/types.js";

interface CliArgs {
  designId: string | null;
  interactive: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv;
  const idIdx = args.indexOf("--design");
  const designId = idIdx !== -1 ? args[idIdx + 1] ?? null : null;
  const interactive = !args.includes("--no-interactive");
  return { designId, interactive };
}

function findPendingValidation(filterId: string | null): DesignMetadata[] {
  const results: DesignMetadata[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === "metadata.json") {
        try {
          const meta = JSON.parse(readFileSync(full, "utf-8")) as DesignMetadata;
          if (meta.status === "pending-validation") {
            if (filterId === null || meta.id === filterId) results.push(meta);
          }
        } catch {
          // skip malformed
        }
      } else {
        try {
          if (readdirSync(full)) walk(full);
        } catch {
          // not a directory
        }
      }
    }
  }

  walk("output");
  return results;
}

function loadImage(meta: DesignMetadata): { base64: string; mimeType: string } {
  const path = meta.files.original;
  const buf = readFileSync(path);
  const mimeType = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return { base64: buf.toString("base64"), mimeType };
}

async function validateOne(meta: DesignMetadata): Promise<ValidationResult> {
  const prompt = buildValidatorPrompt(
    meta.nicheContext,
    meta.concept,
    meta.style,
    meta.product,
    meta.variation
  );
  const { base64, mimeType } = loadImage(meta);
  const raw = await analyzeImage<Partial<ValidationResult>>(base64, mimeType, prompt);
  return normalizeValidation(raw, getConfig().validator.vision_model);
}

function printVerdict(meta: DesignMetadata, v: ValidationResult): void {
  const emoji = v.verdict === "approved" ? "✅" : v.verdict === "borderline" ? "🟡" : "❌";
  console.log(
    `  ${emoji} ${meta.id} — ${v.verdict} (overall ${v.scores.overall.toFixed(1)}/10) [${meta.product}/${meta.variation}]`
  );
}

async function main(): Promise<void> {
  const { designId, interactive } = parseArgs();
  const cfg = getConfig();

  console.log(
    `\n🧠 Validator IA — modelo=${cfg.validator.vision_model}, market=${cfg.market.country}, threshold=${cfg.validator.approval_threshold}`
  );

  let pending = findPendingValidation(designId);

  if (pending.length === 0) {
    console.log("\n✅ No hay diseños en pending-validation.");
    if (designId) console.log(`   (Filtro --design ${designId} no encontró nada.)`);
    else console.log("   Genera diseños primero: pnpm generate --niche \"...\"");
    return;
  }

  console.log(`   Diseños a evaluar: ${pending.length}\n`);

  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    : null;

  const stats = {
    approved: 0,
    borderline: 0,
    rejected: 0,
    regenerated: 0,
    forced: 0,
    skipped: 0,
    errors: 0,
  };

  // Process queue dynamically — regenerations can add new items
  const queue = [...pending];
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
    console.log(""); // newline
    printVerdict(meta, verdict);

    if (verdict.verdict === "approved") {
      persistApprovedOrBorderline(meta, verdict);
      stats.approved++;
      continue;
    }
    if (verdict.verdict === "borderline") {
      persistApprovedOrBorderline(meta, verdict);
      stats.borderline++;
      continue;
    }
    // Rejected
    if (!interactive || !rl) {
      // CI mode — auto-skip
      persistApprovedOrBorderline({ ...meta, status: "rejected" } as DesignMetadata, verdict);
      stats.skipped++;
      continue;
    }
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

  rl?.close();

  // Summary
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  Resumen del validador:");
  console.log(`  ✅ Aprobados:        ${stats.approved}`);
  console.log(`  🟡 Borderline:       ${stats.borderline}`);
  console.log(`  ❌ Rechazados:       ${stats.rejected}`);
  console.log(`  ⚡ Force-approved:   ${stats.forced}`);
  console.log(`  🔄 Regenerados:      ${stats.regenerated}`);
  console.log(`  ⏭  Skipped (CI):     ${stats.skipped}`);
  if (stats.errors > 0) console.log(`  💥 Errores:          ${stats.errors}`);

  const toReview = stats.approved + stats.borderline + stats.forced;
  if (toReview > 0) {
    console.log(`\n  Siguiente paso: pnpm review  (${toReview} diseños en pending-review)\n`);
  } else {
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Validator failed:", err);
    process.exit(1);
  });
