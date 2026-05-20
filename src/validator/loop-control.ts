/**
 * Handles the interactive flow when the validator rejects a design.
 *
 * Hard guarantee against infinite loops: regeneration is offered ONLY if
 * `regenerationCount < validator.max_regenerations`. After that, the menu
 * shows only skip / force-approve / view.
 *
 * The actual regenerated image is produced by re-invoking the existing
 * `generateDesign()` helper with a `regenerationContext` carrying the
 * validator's `suggestedImprovements`. The new design enters the pipeline
 * as `pending-validation` with `regenerationCount = parent + 1`.
 */
import { readFileSync } from "fs";
import { dirname } from "path";
import * as readline from "readline";
import { generateDesign } from "../generator/image-generator.js";
import { getConfig } from "../lib/config.js";
import { moveDesign, writeMeta } from "../lib/design-store.js";
import type { DesignMetadata, ValidationResult } from "../generator/types.js";

export type RejectionAction =
  | { kind: "regenerate"; newDesign: DesignMetadata }
  | { kind: "skip" }
  | { kind: "force-approve" };

function divider(): string {
  return "─".repeat(60);
}

function printRejection(meta: DesignMetadata, v: ValidationResult): void {
  const cfg = getConfig();
  console.log(`\n${divider()}`);
  console.log(`  ❌ RECHAZADO por validador IA`);
  console.log(divider());
  console.log(`  Design ID:    ${meta.id}`);
  console.log(`  Nicho:        ${meta.niche}`);
  console.log(`  Concepto:     ${meta.concept}`);
  console.log(`  Score overall: ${v.scores.overall.toFixed(1)}/10  (umbral aprobación: ${cfg.validator.approval_threshold})`);
  console.log(`    - nicheRelevance:   ${v.scores.nicheRelevance}/10`);
  console.log(`    - trendAlignment:   ${v.scores.trendAlignment}/10`);
  console.log(`    - commercialAppeal: ${v.scores.commercialAppeal}/10`);
  console.log(`    - printability:     ${v.scores.printability}/10`);

  if (v.reasons.blockers.length > 0) {
    console.log(`\n  Blockers:`);
    v.reasons.blockers.forEach((b) => console.log(`    • ${b}`));
  }
  if (v.reasons.concerns.length > 0) {
    console.log(`\n  Concerns:`);
    v.reasons.concerns.forEach((c) => console.log(`    • ${c}`));
  }
  if (v.suggestedImprovements.length > 0) {
    console.log(`\n  Sugerencias para regenerar:`);
    v.suggestedImprovements.forEach((s) => console.log(`    • ${s}`));
  }
  const current = meta.regenerationCount ?? 0;
  const cap = cfg.validator.max_regenerations;
  console.log(`\n  Intentos previos: ${current}/${cap}`);
  console.log(divider());
}

function prompt(rl: readline.Interface, msg: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(msg);
    rl.once("line", (line) => resolve(line.trim().toLowerCase()));
  });
}

async function regenerate(
  meta: DesignMetadata,
  v: ValidationResult
): Promise<DesignMetadata | null> {
  // Place new design alongside the parent — same dated niche folder
  const outputDir = dirname(dirname(meta.files.original));
  const parentCount = meta.regenerationCount ?? 0;

  console.log(`\n  🔄 Regenerando con sugerencias del validador...`);

  const result = await generateDesign(
    {
      niche: meta.niche,
      concept: meta.concept,
      style: meta.style,
      product: meta.product,
      outputDir,
      index: parentCount + 1, // disambiguates the ID
      ...(meta.nicheContext ? { nicheContext: meta.nicheContext } : {}),
      regenerationContext: {
        parentId: meta.id,
        parentCount,
        improvementHints: v.suggestedImprovements,
      },
    },
    meta.variation
  );

  if (result.skipped) {
    console.log(`  ❌ Regeneración falló: ${result.error ?? "desconocido"}`);
    return null;
  }
  console.log(`  ✓ Nuevo diseño generado: ${result.metadata.id} (status: pending-validation)`);
  return result.metadata;
}

export function markRejected(meta: DesignMetadata, v: ValidationResult): void {
  writeMeta({ ...meta, status: "rejected", validation: v });
}

function markForceApproved(meta: DesignMetadata, v: ValidationResult): void {
  writeMeta({ ...meta, status: "pending-review", validation: v, forceApproved: true });
}

/**
 * Auto-approve path (hybrid review): a design the validator scored at/above the
 * approval threshold skips the manual review queue and moves straight to
 * `approved/`, ready for the publisher. Returns the relocated metadata.
 */
export function promoteToApproved(
  meta: DesignMetadata,
  v: ValidationResult
): DesignMetadata {
  return moveDesign({ ...meta, validation: v }, "approved");
}

/**
 * Non-interactive regeneration used by `auto_regenerate` mode and the reviewer's
 * [G] action. Regenerates with the SAME image model + the validator's
 * `suggestedImprovements` (see `regenerate()` → `generateDesign()` →
 * `generateImage()`), marks the original as rejected, and returns the new
 * `pending-validation` design. Returns null when the regeneration cap is reached
 * or generation fails (caller decides how to mark the original in that case).
 */
export async function autoRegenerate(
  meta: DesignMetadata,
  v: ValidationResult
): Promise<DesignMetadata | null> {
  const current = meta.regenerationCount ?? 0;
  if (current >= getConfig().validator.max_regenerations) return null;
  const newDesign = await regenerate(meta, v);
  if (!newDesign) return null;
  markRejected(meta, v); // original is terminal — its successor takes over
  return newDesign;
}

export async function handleRejection(
  meta: DesignMetadata,
  v: ValidationResult,
  rl: readline.Interface
): Promise<RejectionAction> {
  const cfg = getConfig();
  const current = meta.regenerationCount ?? 0;
  const canRegenerate = current < cfg.validator.max_regenerations;

  printRejection(meta, v);

  while (true) {
    const menuLines = [
      "",
      "  ¿Qué hacer?",
      canRegenerate
        ? `    [R] Regenerar con sugerencias  (queda${cfg.validator.max_regenerations - current === 1 ? "" : "n"} ${cfg.validator.max_regenerations - current} intento${cfg.validator.max_regenerations - current === 1 ? "" : "s"})`
        : `    [R] Regenerar — NO disponible (cap ${cfg.validator.max_regenerations} alcanzado)`,
      "    [S] Saltar — marcar como rechazado",
      "    [F] Forzar aprobación — pasa a pending-review pese al rechazo",
      "    [V] Ver JSON completo del validador",
      "",
    ];
    console.log(menuLines.join("\n"));

    const input = await prompt(rl, "  Opción: ");
    switch (input) {
      case "r": {
        if (!canRegenerate) {
          console.log("  ⚠️  Regeneración no disponible (cap alcanzado). Elige S o F.");
          continue;
        }
        const newDesign = await regenerate(meta, v);
        if (!newDesign) {
          console.log("  ⚠️  Regeneración falló. Elige otra opción.");
          continue;
        }
        // Mark original as rejected (terminal — its successor takes over)
        markRejected(meta, v);
        return { kind: "regenerate", newDesign };
      }
      case "s":
        markRejected(meta, v);
        console.log("  ❌ Marcado como rechazado.");
        return { kind: "skip" };
      case "f":
        markForceApproved(meta, v);
        console.log("  ⚡ Forzado a pending-review (force-approved flag set).");
        return { kind: "force-approve" };
      case "v":
        console.log("\n" + JSON.stringify(v, null, 2) + "\n");
        continue;
      default:
        console.log("  Opción inválida. R/S/F/V.");
    }
  }
}

/**
 * Convenience helper used by the validator orchestrator after a non-rejected
 * verdict — persists the verdict and moves status forward to pending-review.
 */
export function persistApprovedOrBorderline(
  meta: DesignMetadata,
  v: ValidationResult
): void {
  writeMeta({ ...meta, status: "pending-review", validation: v });
}

/**
 * Re-read a design's metadata from disk (used after regeneration to find the
 * new pending-validation file the next iteration must pick up).
 */
export function readDesignMetadata(metadataPath: string): DesignMetadata {
  return JSON.parse(readFileSync(metadataPath, "utf-8")) as DesignMetadata;
}
