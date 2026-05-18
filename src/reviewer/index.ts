/**
 * Semana 4 — revisor de diseños.
 * Uso: pnpm review
 * Muestra cada diseño pending-review y espera input: [A]probar / [R]echazar / Re[G]enerar / [S]altar
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync } from "fs";
import { join, dirname, basename } from "path";
import * as readline from "readline";
import type { DesignMetadata } from "../generator/types.js";

// ── Find all pending-review designs ──────────────────────────────────────────

function findPendingDesigns(): DesignMetadata[] {
  const results: DesignMetadata[] = [];

  function walk(dir: string) {
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
          if (meta.status === "pending-review") results.push(meta);
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

// ── Display design info ───────────────────────────────────────────────────────

function displayDesign(meta: DesignMetadata, index: number, total: number) {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log(`  Diseño ${index}/${total}`);
  console.log(divider);
  console.log(`  ID:        ${meta.id}`);
  console.log(`  Nicho:     ${meta.niche}`);
  console.log(`  Concepto:  ${meta.concept}`);
  console.log(`  Producto:  ${meta.product}`);
  console.log(`  Variación: ${meta.variation}`);
  console.log(`  Archivo:   ${meta.files.original}`);
  if (meta.files.noBg) {
    console.log(`  Sin fondo: ${meta.files.noBg}`);
  }
  if (meta.validation) {
    const v = meta.validation;
    const badge = meta.forceApproved ? " (FORCE-APPROVED)" : "";
    console.log(`  Validador IA: ${v.verdict}${badge} — overall ${v.scores.overall.toFixed(1)}/10`);
    console.log(`    niche=${v.scores.nicheRelevance} trend=${v.scores.trendAlignment} appeal=${v.scores.commercialAppeal} print=${v.scores.printability}`);
    if (v.reasons.strengths.length > 0) {
      console.log(`    + ${v.reasons.strengths.slice(0, 2).join("; ")}`);
    }
    if (v.reasons.concerns.length > 0) {
      console.log(`    ! ${v.reasons.concerns.slice(0, 2).join("; ")}`);
    }
  }
  console.log(divider);
  console.log("  [A] Aprobar   [R] Rechazar   [G] Regenerar   [S] Saltar");
  process.stdout.write("  Opción: ");
}

// ── Move design to approved/ or rejected/ ────────────────────────────────────

function moveDesign(meta: DesignMetadata, dest: "approved" | "rejected"): DesignMetadata {
  const srcDir = dirname(meta.files.original);
  const destDir = join(dest, meta.id);

  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  rmSync(srcDir, { recursive: true, force: true });

  const updatedFiles: DesignMetadata["files"] = {
    original: join(destDir, basename(meta.files.original)),
    ...(meta.files.noBg ? { noBg: join(destDir, basename(meta.files.noBg)) } : {}),
  };

  const updatedMeta: DesignMetadata = {
    ...meta,
    status: dest === "approved" ? "approved" : "rejected",
    files: updatedFiles,
  };

  writeFileSync(join(destDir, "metadata.json"), JSON.stringify(updatedMeta, null, 2));
  return updatedMeta;
}

// ── Readline prompt ───────────────────────────────────────────────────────────

function prompt(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    rl.once("line", (line) => resolve(line.trim().toLowerCase()));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pending = findPendingDesigns();

  if (pending.length === 0) {
    console.log("\n✅ No hay diseños pendientes de revisión.\n");
    console.log("   Genera diseños primero: pnpm generate --niche \"...\"\n");
    process.exit(0);
  }

  console.log(`\n🎨 Revisión de diseños — ${pending.length} pendientes`);
  console.log("   Abre los archivos PNG en tu explorador de archivos mientras revisas.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const stats = { approved: 0, rejected: 0, skipped: 0, toRegenerate: [] as string[] };

  for (let i = 0; i < pending.length; i++) {
    const meta = pending[i] as DesignMetadata;
    displayDesign(meta, i + 1, pending.length);

    let handled = false;
    while (!handled) {
      const input = await prompt(rl);

      switch (input) {
        case "a":
          moveDesign(meta, "approved");
          stats.approved++;
          console.log("  ✅ Aprobado");
          handled = true;
          break;

        case "r":
          moveDesign(meta, "rejected");
          stats.rejected++;
          console.log("  ❌ Rechazado");
          handled = true;
          break;

        case "g":
          // Mark for regeneration — keep as pending, log concept
          stats.toRegenerate.push(`${meta.niche} / ${meta.concept} (${meta.product})`);
          console.log("  🔄 Marcado para regenerar — se mantendrá como pending-review");
          handled = true;
          break;

        case "s":
          stats.skipped++;
          console.log("  ⏭  Saltado");
          handled = true;
          break;

        default:
          process.stdout.write("  Opción inválida. [A/R/G/S]: ");
      }
    }
  }

  rl.close();

  // Summary
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  Resumen de revisión:");
  console.log(`  ✅ Aprobados:   ${stats.approved}`);
  console.log(`  ❌ Rechazados:  ${stats.rejected}`);
  console.log(`  ⏭  Saltados:    ${stats.skipped}`);
  console.log(`  🔄 Regenerar:   ${stats.toRegenerate.length}`);

  if (stats.toRegenerate.length > 0) {
    console.log("\n  Para regenerar:");
    stats.toRegenerate.forEach((r) => console.log(`    • ${r}`));
  }

  if (stats.approved > 0) {
    console.log(`\n  Siguiente paso: pnpm publish-drafts`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Reviewer failed:", err);
  process.exit(1);
});
