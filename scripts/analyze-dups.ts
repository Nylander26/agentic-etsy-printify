/**
 * READ-ONLY analysis of Printify duplicates before deleting anything.
 * Compares several dedup signals so we pick the safest one.
 * Run: pnpm tsx scripts/analyze-dups.ts
 */
import axios from "axios";
import "dotenv/config";
import { walkDesigns } from "../src/lib/design-store.js";
import { getShops } from "../src/lib/printify.js";

const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}` },
});

interface Prod { id: string; title: string; created_at: string; blueprint_id: number; print_provider_id: number; }

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
  // Local mapping from metadata.json drafts[]
  const idToDesign = new Map<string, { designId: string; product: string }>();
  const designKeyToIds = new Map<string, string[]>(); // designId::product -> [printifyId]
  for (const root of ["approved", "rejected", "output"]) {
    const designs = walkDesigns(root, (m) => Array.isArray((m as { drafts?: unknown }).drafts));
    for (const { meta } of designs) {
      const drafts = (meta as unknown as { drafts: Array<{ product: string; printifyProductId: string }> }).drafts ?? [];
      for (const d of drafts) {
        idToDesign.set(d.printifyProductId, { designId: meta.id, product: d.product });
        const k = `${meta.id}::${d.product}`;
        if (!designKeyToIds.has(k)) designKeyToIds.set(k, []);
        designKeyToIds.get(k)!.push(d.printifyProductId);
      }
    }
  }

  const shops = await getShops();
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0]!;
  const products = await fetchAll(shop.id);
  const liveIds = new Set(products.map((p) => p.id));
  console.log(`Printify "${shop.title}": ${products.length} productos vivos.`);
  console.log(`Local: ${idToDesign.size} draft-ids en metadata, ${designKeyToIds.size} claves designId::product.`);

  // Signal A: same design+product mapped to >1 LIVE printify id → certain dups
  let aGroups = 0, aExtras = 0;
  for (const [k, ids] of designKeyToIds) {
    const live = ids.filter((id) => liveIds.has(id));
    if (live.length > 1) { aGroups++; aExtras += live.length - 1; void k; }
  }
  console.log(`\n[A] Mismo diseño+producto con >1 producto vivo: ${aGroups} grupos → ${aExtras} extras (dups CIERTOS).`);

  // Signal B: exact title
  const byTitle = new Map<string, Prod[]>();
  for (const p of products) { const k = p.title.trim().toLowerCase(); (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(p); }
  const bExtras = [...byTitle.values()].filter((g) => g.length > 1).reduce((a, g) => a + g.length - 1, 0);
  console.log(`[B] Título exacto duplicado: ${[...byTitle.values()].filter((g) => g.length > 1).length} grupos → ${bExtras} extras.`);

  // Signal C: normalized title
  const byNorm = new Map<string, Prod[]>();
  for (const p of products) { const k = normTitle(p.title); (byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(p); }
  const cGroups = [...byNorm.values()].filter((g) => g.length > 1);
  const cExtras = cGroups.reduce((a, g) => a + g.length - 1, 0);
  console.log(`[C] Título normalizado duplicado: ${cGroups.length} grupos → ${cExtras} extras.`);
  cGroups.slice(0, 15).forEach((g) => console.log(`    x${g.length}  ${g[0]!.title.slice(0, 65)}`));

  // Orphans: live products not referenced by any local metadata
  const orphans = products.filter((p) => !idToDesign.has(p.id));
  console.log(`\n[orphans] productos vivos sin entrada en metadata local: ${orphans.length}`);
  console.log(`          (no mapeables a un diseño → solo dedup por título sirve para estos)`);
}

main().catch((e) => { console.error("FAILED:", e?.response?.status, e?.response?.data ?? e?.message); process.exit(1); });
