/**
 * Re-tags products that are ALREADY in Printify (drafted, and possibly already published
 * to Etsy) with tags built by the current, fixed SEO code.
 *
 * Why this exists: `tags` sent in Printify's product-CREATE payload is accepted and
 * silently discarded, so the first batches went live with either no tags or hand-entered
 * ones. On top of that, the tags we had generated were cut mid-word at 20 chars
 * ("Pregnant Announcemen", "Funny Halloween Shir") — worthless as search terms. Both bugs
 * are fixed (`setProductTags` + `sanitizeTag`), but the products already in Printify still
 * carry the old values. This pushes the corrected ones onto them.
 *
 * Safety:
 *   - Dry-run by default. `--apply` is required to write anything.
 *   - Only touches `tags`; title, description, images, variants and price are untouched.
 *   - Reads the tags back from Printify after writing and prints what actually stuck.
 *   - Does NOT publish. A product already live on Etsy keeps serving its current tags
 *     until someone hits "Publish"/"Update" for it in the Printify dashboard — the API's
 *     publish endpoint is deliberately not called here (see note in lib/printify.ts).
 *
 * Usage:
 *   pnpm tsx scripts/retag-drafts.ts                # dry run, shows the diff
 *   pnpm tsx scripts/retag-drafts.ts --apply        # writes to Printify
 *   pnpm tsx scripts/retag-drafts.ts --dir approved # source folder (default: approved)
 *   pnpm tsx scripts/retag-drafts.ts --from-pack data/etsy-packs/<date>/batch-001.json
 *       ↑ re-push the tags the pack already records, verbatim — no Gemini call. Use this
 *         to repair a run whose tags were blanked by a later PUT, so what Printify holds
 *         matches the pack the shop owner reads.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { getConfig } from "../src/lib/config.js";
import { getProduct, setProductTags } from "../src/lib/printify.js";
import { generateSEO } from "../src/publisher/seo.js";
import { budgetReport } from "../src/lib/budget.js";
import type { DesignMetadata } from "../src/generator/types.js";

const APPLY = process.argv.includes("--apply");
const dirIdx = process.argv.indexOf("--dir");
const SOURCE_DIR = dirIdx !== -1 ? (process.argv[dirIdx + 1] ?? "approved") : "approved";
const packIdx = process.argv.indexOf("--from-pack");
const FROM_PACK = packIdx !== -1 ? (process.argv[packIdx + 1] ?? null) : null;

interface Target {
  designId: string;
  productId: string;
  /** Absent when the targets come from a pack — then `tags` is authoritative. */
  meta?: DesignMetadata;
  /** Tags to push verbatim (pack mode). When absent, they are regenerated with Gemini. */
  tags?: string[];
}

function loadTargetsFromPack(path: string): Target[] {
  const pack = JSON.parse(readFileSync(path, "utf-8")) as {
    entries?: Array<{ designId: string; printifyProductId: string; tags: string[] }>;
  };
  return (pack.entries ?? []).map((e) => ({
    designId: e.designId,
    productId: e.printifyProductId,
    tags: e.tags,
  }));
}

function loadTargets(dir: string): Target[] {
  if (!existsSync(dir)) return [];
  const out: Target[] = [];
  for (const id of readdirSync(dir)) {
    const metaPath = join(dir, id, "metadata.json");
    if (!statSync(join(dir, id)).isDirectory() || !existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as DesignMetadata;
    for (const d of meta.drafts ?? []) {
      if (d.printifyProductId) out.push({ designId: meta.id, productId: d.printifyProductId, meta });
    }
  }
  return out;
}

/** Keeps the generated etsy-pack in sync so the on-disk record matches what Printify holds. */
function updatePacks(byDesign: Map<string, string[]>): string[] {
  const touched: string[] = [];
  const root = "data/etsy-packs";
  if (!existsSync(root)) return touched;
  for (const day of readdirSync(root)) {
    const dayDir = join(root, day);
    if (!statSync(dayDir).isDirectory()) continue;
    for (const file of readdirSync(dayDir).filter((f) => f.endsWith(".json"))) {
      const path = join(dayDir, file);
      const pack = JSON.parse(readFileSync(path, "utf-8")) as {
        entries?: Array<{ designId: string; tags: string[] }>;
      };
      let changed = false;
      for (const e of pack.entries ?? []) {
        const fresh = byDesign.get(e.designId);
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(e.tags)) {
          e.tags = fresh;
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(path, JSON.stringify(pack, null, 2));
        touched.push(path);
      }
    }
  }
  return touched;
}

async function main(): Promise<void> {
  const shopId = String(getConfig().publishing.shop_id);
  const origin = FROM_PACK ? `pack ${FROM_PACK}` : `"${SOURCE_DIR}/"`;
  const targets = FROM_PACK ? loadTargetsFromPack(FROM_PACK) : loadTargets(SOURCE_DIR);

  console.log(
    `\n🏷  Re-tag de productos ya en Printify — shop ${shopId}, origen ${origin}` +
      `\n   tags: ${FROM_PACK ? "los del pack, verbatim (0 llamadas Gemini)" : "regenerados con el SEO actual"}` +
      `\n   modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe nada)"}\n`
  );

  if (targets.length === 0) {
    console.log(`No hay diseños con drafts en ${origin}. Nada que hacer.\n`);
    return;
  }

  const byDesign = new Map<string, string[]>();
  let written = 0;

  for (const t of targets) {
    console.log("─".repeat(72));
    console.log(`${t.designId}\n  producto Printify: ${t.productId}`);

    const live = (await getProduct(shopId, t.productId)) as unknown as {
      title?: string;
      tags?: string[];
      external?: { id?: string; handle?: string };
    };
    const published = !!live.external?.id;
    console.log(`  título en Printify: ${(live.title ?? "").slice(0, 66)}`);
    console.log(`  en Etsy: ${published ? `SÍ (listing ${live.external?.id})` : "no (solo draft)"}`);
    console.log(`  tags ahora  (${live.tags?.length ?? 0}): ${JSON.stringify(live.tags ?? [])}`);

    const newTags =
      t.tags ??
      (
        await generateSEO(t.meta as DesignMetadata, {
          nicheKeywords: t.meta?.nicheContext?.topTags ?? [],
          avgPrice: t.meta?.nicheContext?.avgPrice ?? 24.99,
          price: 29.99,
        })
      ).tags;
    console.log(`  tags nuevos (${newTags.length}): ${JSON.stringify(newTags)}`);

    const tooLong = newTags.filter((x) => x.length > 20);
    if (tooLong.length) console.log(`  ⚠ pasan de 20 chars: ${JSON.stringify(tooLong)}`);
    const dupes = newTags.length !== new Set(newTags.map((x) => x.toLowerCase())).size;
    if (dupes) console.log(`  ⚠ hay duplicados — Etsy los rechaza`);

    byDesign.set(t.designId, newTags);

    if (!APPLY) continue;

    const after = await setProductTags(shopId, t.productId, newTags);
    const stuck = JSON.stringify(after) === JSON.stringify(newTags.slice(0, 13));
    console.log(`  → Printify reporta (${after.length}): ${JSON.stringify(after)}`);
    console.log(stuck ? "  ✅ guardados" : "  ⚠ NO coinciden con lo enviado");
    if (stuck) written++;
  }

  console.log("─".repeat(72));

  if (APPLY) {
    const packs = updatePacks(byDesign);
    console.log(`\n✅ ${written}/${targets.length} productos re-tagueados.`);
    if (packs.length) console.log(`   Packs actualizados: ${packs.join(", ")}`);
    console.log(
      `\n⚠️  Los que ya están en Etsy siguen sirviendo sus tags viejos hasta que se\n` +
        `   re-publiquen. Printify → producto → "Publish"/"Update" (usa el listing que ya\n` +
        `   existe, no crea uno nuevo). Este script NO publica a propósito.`
    );
  } else {
    console.log(`\nDry run. Nada escrito. Para aplicarlo:\n   pnpm tsx scripts/retag-drafts.ts --apply`);
  }
  console.log(`   ${budgetReport()}\n`);
}

main().catch((err) => {
  console.error("retag-drafts failed:", err);
  process.exit(1);
});
