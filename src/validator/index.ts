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
import { getConfig } from "../lib/config.js";
import { walkDesigns } from "../lib/design-store.js";
import {
  validateDesigns,
  printValidationSummary,
  toReviewCount,
} from "./run.js";
import type { DesignMetadata } from "../generator/types.js";

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
  return walkDesigns(
    "output",
    (m) => m.status === "pending-validation" && (filterId === null || m.id === filterId)
  ).map((f) => f.meta);
}

async function main(): Promise<void> {
  const { designId, interactive } = parseArgs();
  const cfg = getConfig();

  console.log(
    `\n🧠 Validator IA — modelo=${cfg.validator.vision_model}, market=${cfg.market.country}, threshold=${cfg.validator.approval_threshold}`
  );

  const pending = findPendingValidation(designId);

  if (pending.length === 0) {
    console.log("\n✅ No hay diseños en pending-validation.");
    if (designId) console.log(`   (Filtro --design ${designId} no encontró nada.)`);
    else console.log("   Genera diseños primero: pnpm generate --niche \"...\"");
    return;
  }

  console.log(`   Diseños a evaluar: ${pending.length}`);
  console.log(
    `   Modo: auto_approve_passing=${cfg.validator.auto_approve_passing}, auto_regenerate=${cfg.validator.auto_regenerate}\n`
  );

  // Shared engine — same routing the pipeline uses.
  const stats = await validateDesigns(pending, { interactive });

  printValidationSummary(stats);

  const toReview = toReviewCount(stats);
  if (toReview > 0) {
    console.log(`\n  Siguiente paso: pnpm review  (${toReview} diseños en pending-review)`);
  }
  if (stats.autoApproved > 0) {
    console.log(`\n  ${stats.autoApproved} auto-aprobados listos: pnpm publish-drafts`);
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Validator failed:", err);
    process.exit(1);
  });
