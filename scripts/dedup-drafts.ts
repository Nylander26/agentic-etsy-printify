/**
 * Draft dedup utility.
 *
 *   pnpm tsx scripts/dedup-drafts.ts            # READ-ONLY: backfill local index + report Printify dups
 *   pnpm tsx scripts/dedup-drafts.ts --apply    # also DELETE duplicate Printify products (keeps oldest)
 *
 * Backfill: imports every draft recorded in local metadata.json `drafts[]` arrays into the
 * central draft index so future `pnpm publish-drafts` runs skip what already exists.
 *
 * Report/cleanup: groups existing Printify products by title; duplicates are the extra
 * products beyond the first (oldest by created_at). `--apply` deletes the extras.
 */
import axios from "axios";
import "dotenv/config";
import { walkDesigns } from "../src/lib/design-store.js";
import { recordDraft } from "../src/lib/draft-index.js";
import { getShops, deleteProduct } from "../src/lib/printify.js";
import type { ProductType } from "../src/generator/types.js";

const APPLY = process.argv.includes("--apply");

const TOKEN = process.env.PRINTIFY_API_TOKEN;
const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${TOKEN}` },
});

interface DraftRecord {
  product: ProductType;
  printifyProductId: string;
}

function backfillIndex(): number {
  let n = 0;
  // Walk every lifecycle root — a drafted design may sit in any of them.
  for (const root of ["approved", "rejected", "output"]) {
    const designs = walkDesigns(root, (m) => Array.isArray((m as { drafts?: unknown }).drafts));
    for (const { meta } of designs) {
      const drafts = (meta as unknown as { drafts: DraftRecord[] }).drafts ?? [];
      for (const d of drafts) {
        recordDraft({
          designId: meta.id,
          product: d.product,
          printifyProductId: d.printifyProductId,
          title: meta.id, // local meta has no SEO title; id is enough for the dedup key
        });
        n++;
      }
    }
  }
  return n;
}

async function fetchAllProducts(shopId: string) {
  const all: Array<{ id: string; title: string; created_at: string }> = [];
  let page = 1;
  for (;;) {
    const res = (await http.get(`/shops/${shopId}/products.json?limit=50&page=${page}`)).data as {
      data: Array<{ id: string; title: string; created_at: string }>;
      last_page: number;
    };
    all.push(...res.data);
    if (page >= (res.last_page ?? 1)) break;
    page++;
  }
  return all;
}

async function main() {
  const imported = backfillIndex();
  console.log(`Backfill: ${imported} drafts importados al índice central desde metadata.json local.`);

  const shops = await getShops();
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) throw new Error("No Printify shop found");

  const products = await fetchAllProducts(shop.id);
  console.log(`\nPrintify "${shop.title}": ${products.length} productos.`);

  // Group by normalized title; oldest survives.
  const byTitle = new Map<string, typeof products>();
  for (const p of products) {
    const key = p.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push(p);
  }

  const dupGroups = [...byTitle.values()].filter((g) => g.length > 1);
  const toDelete: typeof products = [];
  for (const group of dupGroups) {
    const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
    toDelete.push(...sorted.slice(1)); // keep oldest
  }

  console.log(`Títulos duplicados: ${dupGroups.length} grupos → ${toDelete.length} productos sobrantes.`);
  dupGroups.slice(0, 20).forEach((g) => console.log(`  x${g.length}  ${g[0]!.title.slice(0, 70)}`));

  if (!APPLY) {
    console.log(`\n(READ-ONLY) Re-ejecuta con --apply para BORRAR los ${toDelete.length} duplicados (conserva el más antiguo).`);
    return;
  }

  console.log(`\n--apply: borrando ${toDelete.length} duplicados...`);
  let deleted = 0;
  for (const p of toDelete) {
    try {
      await deleteProduct(shop.id, p.id);
      deleted++;
      process.stdout.write(`\r  borrados ${deleted}/${toDelete.length}`);
    } catch (e: unknown) {
      console.error(`\n  ✗ ${p.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n✓ ${deleted} duplicados borrados.`);
}

main().catch((e) => {
  console.error("FAILED:", e?.response?.status, e?.response?.data ?? e?.message);
  process.exit(1);
});
