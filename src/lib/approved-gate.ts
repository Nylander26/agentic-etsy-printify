/**
 * Pre-run gate for the `approved/` directory.
 *
 * Designs that reached `approved/` in a previous run already have their artwork
 * uploaded to Printify (content-addressed there), so carrying them into a fresh
 * `pnpm pipeline` / `pnpm discover` iteration is just local noise. This asks the
 * user — before any work starts — whether to wipe `approved/` or keep it.
 *
 * Safety:
 *   - Default is KEEP. Nothing is deleted without an explicit "yes".
 *   - Only design folders (those holding a `metadata.json`) are removed.
 *   - Never touches `output/.draft-index.json` (it lives under output/, not here).
 */
import { readdirSync, statSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { askApproval } from "./approval.js";

const APPROVED_DIR = "approved";

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Subdirectories of `approved/` that hold a metadata.json (i.e. a real design). */
function listApprovedDesignDirs(): string[] {
  if (!isDir(APPROVED_DIR)) return [];
  const out: string[] = [];
  for (const id of readdirSync(APPROVED_DIR)) {
    const dir = join(APPROVED_DIR, id);
    if (isDir(dir) && existsSync(join(dir, "metadata.json"))) out.push(dir);
  }
  return out;
}

/**
 * If `approved/` holds designs from previous runs, ask whether to wipe them.
 * Returns the number of design folders removed (0 if kept or none present).
 */
export async function maybeClearApproved(): Promise<number> {
  const dirs = listApprovedDesignDirs();
  if (dirs.length === 0) return 0;

  const choice = await askApproval(
    `Hay ${dirs.length} diseño(s) en approved/ de runs anteriores (ya subidos a Printify). ` +
      `¿Vaciar la carpeta antes de empezar?`,
    [
      {
        label: "Sí, vaciar approved/",
        detail: "borra solo las carpetas locales; el arte sigue en Printify",
      },
    ]
  );

  const wipe = choice.kind === "all" || choice.kind === "select";
  if (!wipe) {
    console.log(`  ↳ approved/ intacto (${dirs.length} diseño(s) conservado(s)).`);
    return 0;
  }

  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  console.log(`  🧹 approved/ vaciado: ${dirs.length} carpeta(s) borrada(s).`);
  return dirs.length;
}
