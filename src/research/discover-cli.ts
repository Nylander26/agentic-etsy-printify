/**
 * CLI standalone de discovery — muestra todos los eventos de la ventana de compra
 * y permite seleccionar nichos uno a uno antes de lanzar el pipeline o research.
 *
 * Usage:
 *   pnpm discover          # preview + selección interactiva
 *
 * Tras la selección imprime el/los keywords elegidos con el comando exacto
 * para lanzarlos, sin modificar config.yaml.
 */
import { discoverNiches, selectDiscoveredNiches } from "./discovery.js";
import { getConfig } from "../lib/config.js";

async function main(): Promise<void> {
  const cfg = getConfig().research;
  if (!cfg.auto_discover) {
    console.warn(
      "⚠️  research.auto_discover=false en config.yaml\n" +
      "    Esta CLI corre discovery de todas formas para que veas qué saldría.\n"
    );
  }

  // ── Discovery ──────────────────────────────────────────────────────────────
  const discovered = await discoverNiches();

  if (discovered.length === 0) {
    console.error("\n❌ Discovery no encontró candidatos.");
    process.exit(1);
  }

  // ── Selección interactiva (gate compartido con el pipeline — render rico) ──
  const selected = await selectDiscoveredNiches(
    `${discovered.length} nichos del calendario. ¿Cuál procesamos?`,
    discovered
  );

  if (selected.length === 0) {
    console.log("\n⏹  Cancelado.\n");
    process.exit(0);
  }

  // ── Instrucciones de seguimiento ──────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log(`✅  ${selected.length} niche(s) seleccionado(s):\n`);

  for (const n of selected) {
    const anchor = n.anchorEvent ? ` [${n.anchorEvent}]` : "";
    console.log(`  • "${n.keyword}"${anchor}`);
  }

  const seedsArg = selected.map((n) => n.keyword).join(",");
  console.log("\nPara lanzarlos:");
  if (selected.length === 1) {
    const kw = selected[0]!.keyword;
    console.log(`  pnpm research --seeds "${kw}"`);
    console.log(`  pnpm generate --niche "${kw}" --products tshirt`);
    console.log(`  pnpm pipeline --seeds "${kw}"`);
  } else {
    console.log(`  pnpm research --seeds "${seedsArg}"`);
    console.log(`  pnpm pipeline --seeds "${seedsArg}"`);
    console.log();
    console.log("  (para procesarlos uno a uno, lanza cada keyword por separado)");
    for (const n of selected) {
      console.log(`  pnpm pipeline --seeds "${n.keyword}"`);
    }
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Discover failed:", err);
    process.exit(1);
  });
