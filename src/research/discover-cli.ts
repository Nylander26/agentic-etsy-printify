/**
 * CLI entry — run discovery standalone and dump results to stdout.
 * Usage: pnpm discover
 *
 * Does NOT generate any designs. Use this to preview which niches the agent
 * would pick before committing to a full pipeline run.
 */
import { discoverNiches } from "./discovery.js";
import { getConfig } from "../lib/config.js";

async function main(): Promise<void> {
  const cfg = getConfig().research;
  if (!cfg.auto_discover) {
    console.warn(
      "⚠️  research.auto_discover=false en config.yaml — el pipeline normal usará keywords_seed.\n" +
      "    Esta CLI corre discovery de todas formas para que veas qué saldría.\n"
    );
  }

  const discovered = await discoverNiches();

  console.log("\n" + "═".repeat(60));
  console.log(`📋 ${discovered.length} nichos descubiertos:`);
  discovered.forEach((n, i) => {
    const price = n.avgPrice !== null ? `$${n.avgPrice.toFixed(2)}` : "$?";
    console.log(
      `\n  ${i + 1}. "${n.keyword}"\n` +
      `     demand≈${n.expectedDemand}/10 · sample=${n.sampledListings} · avgPrice=${price}\n` +
      `     ${n.rationale}`
    );
    if (n.avgTitlePreview.length > 0) {
      console.log(`     sample: ${n.avgTitlePreview.map((t) => `"${t.slice(0, 50)}"`).join(" · ")}`);
    }
  });
  console.log("\n   Para usarlos: pnpm research  (con auto_discover=true), o pnpm pipeline\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Discover failed:", err);
    process.exit(1);
  });
