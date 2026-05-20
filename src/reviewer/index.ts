/**
 * Semana 4 — revisor de diseños (con acciones en lote).
 * Uso: pnpm review
 *
 * Solo muestra diseños en `pending-review`. Con el flujo híbrido eso es
 * borderline + force-approved — los que el validador aprobó con holgura ya
 * fueron movidos a approved/ automáticamente.
 *
 * Acciones:
 *   - En lote: [AA] aprobar TODO · [RA] rechazar TODO
 *   - Uno a uno: [A]probar · [R]echazar · [G] regenerar (mismo modelo) · [S]altar
 */
import * as readline from "readline";
import { walkDesigns, moveDesign } from "../lib/design-store.js";
import { autoRegenerate } from "../validator/loop-control.js";
import type { DesignMetadata } from "../generator/types.js";

// ── Find all pending-review designs ──────────────────────────────────────────

function findPendingDesigns(): DesignMetadata[] {
  return walkDesigns("output", (m) => m.status === "pending-review").map((f) => f.meta);
}

// ── Display helpers ───────────────────────────────────────────────────────────

function scoreLabel(meta: DesignMetadata): string {
  if (!meta.validation) return "sin score IA";
  const v = meta.validation;
  const badge = meta.forceApproved ? " ⚡FORCE" : "";
  return `${v.verdict} ${v.scores.overall.toFixed(1)}/10${badge}`;
}

function printList(pending: DesignMetadata[]): void {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log(`  ${pending.length} diseños en pending-review:`);
  pending.forEach((m, i) => {
    console.log(
      `   ${String(i + 1).padStart(2)}. ${m.id}  [${m.product}/${m.variation}]  ${scoreLabel(m)}`
    );
  });
  console.log(divider);
}

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
  console.log("  [A] Aprobar   [R] Rechazar   [G] Regenerar (mismo modelo)   [S] Saltar");
}

// ── Readline prompt ───────────────────────────────────────────────────────────

function prompt(rl: readline.Interface, msg = ""): Promise<string> {
  return new Promise((resolve) => {
    if (msg) process.stdout.write(msg);
    rl.once("line", (line) => resolve(line.trim().toLowerCase()));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pending = findPendingDesigns();

  if (pending.length === 0) {
    console.log("\n✅ No hay diseños pendientes de revisión.\n");
    console.log("   (Con auto_approve_passing=true, los aprobados por la IA ya están en approved/.)\n");
    process.exit(0);
  }

  console.log(`\n🎨 Revisión de diseños — ${pending.length} pendientes`);
  console.log("   Abre los archivos PNG en tu explorador mientras revisas.");
  printList(pending);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const stats = { approved: 0, rejected: 0, skipped: 0, regenerated: 0 };

  // ── Top-level batch decision ────────────────────────────────────────────────
  console.log(
    "\n  Acción en lote: [AA] aprobar TODO · [RA] rechazar TODO · [Enter] revisar uno por uno"
  );
  const top = await prompt(rl, "  Opción: ");

  if (top === "aa") {
    for (const meta of pending) {
      moveDesign(meta, "approved");
      stats.approved++;
    }
    console.log(`  ✅ ${stats.approved} diseños aprobados en lote.`);
  } else if (top === "ra") {
    for (const meta of pending) {
      moveDesign(meta, "rejected");
      stats.rejected++;
    }
    console.log(`  ❌ ${stats.rejected} diseños rechazados en lote.`);
  } else {
    // ── One-by-one ──────────────────────────────────────────────────────────
    for (let i = 0; i < pending.length; i++) {
      const meta = pending[i] as DesignMetadata;
      displayDesign(meta, i + 1, pending.length);

      let handled = false;
      while (!handled) {
        const input = await prompt(rl, "  Opción [A/R/G/S]: ");

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

          case "g": {
            // Same image model + the validator's suggestedImprovements
            // (autoRegenerate → regenerate → generateDesign → generateImage).
            if (!meta.validation) {
              console.log("  ⚠️  Sin datos del validador para regenerar — usa A/R/S.");
              break;
            }
            console.log("  🔄 Regenerando (mismo modelo de imagen + sugerencias del validador)...");
            const newDesign = await autoRegenerate(meta, meta.validation);
            if (newDesign) {
              console.log(`  ✓ Nuevo diseño ${newDesign.id} en pending-validation — corré 'pnpm validate'.`);
              stats.regenerated++;
              handled = true;
            } else {
              console.log("  ⚠️  Cap de regeneraciones alcanzado — usa A/R/S.");
            }
            break;
          }

          case "s":
            stats.skipped++;
            console.log("  ⏭  Saltado");
            handled = true;
            break;

          default:
            console.log("  Opción inválida.");
        }
      }
    }
  }

  rl.close();

  // ── Summary ──────────────────────────────────────────────────────────────────
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  Resumen de revisión:");
  console.log(`  ✅ Aprobados:   ${stats.approved}`);
  console.log(`  ❌ Rechazados:  ${stats.rejected}`);
  if (stats.skipped > 0) console.log(`  ⏭  Saltados:    ${stats.skipped}`);
  if (stats.regenerated > 0) {
    console.log(`  🔄 Regenerados: ${stats.regenerated} (en pending-validation — corré pnpm validate)`);
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
