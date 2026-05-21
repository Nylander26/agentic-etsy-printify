/**
 * Draft dedup utility.
 *
 *   pnpm tsx scripts/dedup-drafts.ts            # READ-ONLY: backfill local index + report dups
 *   pnpm tsx scripts/dedup-drafts.ts --apply    # also DELETE duplicate DRAFTS in Printify
 *
 * Dedup signal: Printify stores uploads content-addressed, so two products built from the
 * SAME artwork share the same uploaded image id (visible in print_areas placeholders). That
 * is a reliable, download-free fingerprint that survives different SEO titles across runs.
 *
 * Safety rules:
 *   - Products PUBLISHED to Etsy (external != null) are NEVER deleted — they are live listings.
 *   - Per artwork group: if any published exists, keep all published and delete the DRAFTS.
 *     If the group is drafts-only, keep the NEWEST draft (it carries the latest pipeline
 *     fixes) and delete the older draft duplicates.
 *   - Products with unique artwork are left untouched (not duplicates).
 *
 * Backfill: imports drafts recorded in local metadata.json `drafts[]` into the central
 * index so future `pnpm publish-drafts` runs skip what already exists.
 */
import axios from "axios";
import "dotenv/config";
import { walkDesigns } from "../src/lib/design-store.js";
import { recordDraft } from "../src/lib/draft-index.js";
import { getShops, deleteProduct } from "../src/lib/printify.js";
import type { ProductType } from "../src/generator/types.js";

const APPLY = process.argv.includes("--apply");

const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}` },
});

interface Prod {
  id: string;
  title: string;
  created_at: string;
  external: { id: string } | null;
  print_areas?: Array<{ placeholders?: Array<{ images?: Array<{ id: string; src?: string }> }> }>;
}

/** Uploaded artwork id = the print-area image with a real src. Stable per design content. */
function artworkId(p: Prod): string | null {
  const imgs = (p.print_areas ?? []).flatMap((a) => a.placeholders ?? []).flatMap((x) => x.images ?? []);
  return imgs.find((i) => i.src && i.src.length > 0)?.id ?? null;
}

function backfillIndex(): number {
  let n = 0;
  for (const root of ["approved", "rejected", "output"]) {
    const designs = walkDesigns(root, (m) => Array.isArray((m as { drafts?: unknown }).drafts));
    for (const { meta } of designs) {
      const drafts = (meta as unknown as { drafts: Array<{ product: ProductType; printifyProductId: string }> }).drafts ?? [];
      for (const d of drafts) {
        recordDraft({ designId: meta.id, product: d.product, printifyProductId: d.printifyProductId, title: meta.id });
        n++;
      }
    }
  }
  return n;
}

async function fetchAll(shopId: string): Promise<Prod[]> {
  const all: Prod[] = [];
  let page = 1;
  for (;;) {
    const res = (await http.get(`/shops/${shopId}/products.json?limit=50&page=${page}`)).data as { data: Prod[]; last_page: number };
    all.push(...res.data);
    if (page >= (res.last_page ?? 1)) break;
    page++;
  }
  return all;
}

async function main() {
  const imported = backfillIndex();
  console.log(`Backfill: ${imported} drafts importados al índice central.`);

  const shops = await getShops();
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) throw new Error("No Printify shop found");

  const products = await fetchAll(shop.id);
  const published = products.filter((p) => p.external);
  console.log(`\nPrintify "${shop.title}": ${products.length} productos (${published.length} publicados, ${products.length - published.length} drafts).`);

  // Group by artwork id
  const byArt = new Map<string, Prod[]>();
  let noArt = 0;
  for (const p of products) {
    const id = artworkId(p);
    if (!id) { noArt++; continue; }
    if (!byArt.has(id)) byArt.set(id, []);
    byArt.get(id)!.push(p);
  }

  // Decide deletions
  const toDelete: Prod[] = [];
  for (const group of byArt.values()) {
    if (group.length < 2) continue;
    const pub = group.filter((p) => p.external);
    const drafts = group.filter((p) => !p.external);
    if (pub.length > 0) {
      toDelete.push(...drafts); // keep live listing(s), drop duplicate drafts
    } else {
      // drafts-only: keep the newest, delete the rest
      const sorted = [...drafts].sort((a, b) => b.created_at.localeCompare(a.created_at));
      toDelete.push(...sorted.slice(1));
    }
  }

  console.log(`Artes distintos: ${byArt.size} | grupos duplicados: ${[...byArt.values()].filter((g) => g.length > 1).length}`);
  console.log(`Drafts duplicados a borrar: ${toDelete.length} (publicados intactos)`);
  if (noArt) console.log(`(${noArt} productos sin arte identificable — ignorados)`);
  toDelete.slice(0, 30).forEach((p) => console.log(`  DEL draft ${p.id}  ${p.title.slice(0, 60)}`));

  if (!APPLY) {
    console.log(`\n(READ-ONLY) Re-ejecuta con --apply para BORRAR los ${toDelete.length} drafts duplicados.`);
    return;
  }

  console.log(`\n--apply: borrando ${toDelete.length} drafts duplicados...`);
  let deleted = 0;
  for (const p of toDelete) {
    try {
      await deleteProduct(shop.id, p.id);
      deleted++;
      process.stdout.write(`\r  borrados ${deleted}/${toDelete.length}`);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number }; message?: string };
      console.error(`\n  ✗ ${p.id}: ${err.response?.status ?? ""} ${err.message ?? e}`);
    }
  }
  console.log(`\n✓ ${deleted} drafts duplicados borrados. Publicados a Etsy: intactos.`);
}

main().catch((e) => {
  console.error("FAILED:", e?.response?.status, e?.response?.data ?? e?.message);
  process.exit(1);
});
