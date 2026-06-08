/**
 * Manual asset cleanup. Uso:
 *   pnpm clean            # dry-run: muestra qué borraría
 *   pnpm clean --apply    # borra de verdad
 *   pnpm clean --apply --keep 5   # override keep_runs
 */
import { getConfig } from "./lib/config.js";
import { cleanupAssets } from "./lib/cleanup.js";

const APPLY = process.argv.includes("--apply");
const keepArg = process.argv.indexOf("--keep");
const keep = keepArg >= 0 ? parseInt(process.argv[keepArg + 1] ?? "", 10) : getConfig().cleanup.keep_runs;
const keepRuns = Number.isFinite(keep) && keep > 0 ? keep : getConfig().cleanup.keep_runs;

const { removed } = cleanupAssets(keepRuns, !APPLY);

if (removed.length === 0) {
  console.log(`Nada que borrar (keep_runs=${keepRuns}).`);
} else {
  console.log(`${APPLY ? "Borradas" : "(dry-run) se borrarían"} ${removed.length} carpetas (keep_runs=${keepRuns}):`);
  for (const p of removed) console.log(`  - ${p}`);
  if (!APPLY) console.log("\nEjecuta con --apply para borrar.");
}
