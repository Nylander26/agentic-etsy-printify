/**
 * Borra TODOS los productos de Printify (drafts + publicados en Etsy).
 * Cuando borra un producto publicado, Printify elimina también el listing de Etsy.
 *
 *   pnpm tsx scripts/nuke-all-listings.ts           # dry-run: muestra shops, pide elección, lista productos
 *   pnpm tsx scripts/nuke-all-listings.ts --apply   # igual pero borra al confirmar
 */
import axios from "axios";
import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getShops, deleteProduct } from "../src/lib/printify.js";
import { clearDraftIndex } from "../src/lib/draft-index.js";

const APPLY = process.argv.includes("--apply");

const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}` },
});

interface Prod {
  id: string;
  title: string;
  external: { id: string } | null;
  created_at: string;
}

async function listAll(shopId: string): Promise<Prod[]> {
  const all: Prod[] = [];
  let page = 1;
  for (;;) {
    const res = (await http.get(`/shops/${shopId}/products.json?limit=50&page=${page}`))
      .data as { data: Prod[]; last_page: number };
    all.push(...res.data);
    if (page >= (res.last_page ?? 1)) break;
    page++;
  }
  return all;
}

async function pickShop() {
  const shops = await getShops();
  if (!shops.length) { console.log("Sin shops."); process.exit(0); }

  console.log("Shops disponibles:");
  shops.forEach((s, i) => console.log(`  [${i + 1}] ${s.title}  (id=${s.id})`));

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("\n¿Cuál shop? (número): ");
  rl.close();

  const idx = parseInt(answer.trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= shops.length) {
    console.error("Número inválido."); process.exit(1);
  }
  return shops[idx];
}

async function main() {
  const shop = await pickShop();
  console.log(`\nShop seleccionado: ${shop.title} (id=${shop.id})\n`);

  const products = await listAll(shop.id);
  if (!products.length) { console.log("Sin productos."); return; }

  const published = products.filter((p) => p.external !== null);
  const drafts    = products.filter((p) => p.external === null);

  console.log(`Total: ${products.length}  |  Publicados en Etsy: ${published.length}  |  Drafts: ${drafts.length}\n`);

  for (const p of products) {
    const tag = p.external ? "[PUBLICADO]" : "[DRAFT]    ";
    console.log(`  ${tag}  ${p.id}  ${p.title.slice(0, 70)}`);
  }

  if (!APPLY) {
    console.log(`\n(dry-run) Nada borrado. Ejecuta con --apply para eliminar los ${products.length} productos.`);
    return;
  }

  console.log(`\nBorrando ${products.length} productos...`);
  let deleted = 0;
  let failed  = 0;

  for (const p of products) {
    try {
      await deleteProduct(shop.id, p.id);
      deleted++;
      process.stdout.write(`\r  ✓ ${deleted}/${products.length}`);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number }; message?: string };
      console.error(`\n  ✗ ${p.id} ${p.title.slice(0, 50)} — ${err.response?.status ?? err.message}`);
      failed++;
    }
  }

  // Keep the local draft registry in sync — these products no longer exist, so the
  // monitor must not keep counting them as "drafted" / flagging them as losers.
  clearDraftIndex();
  console.log("  ✓ draft-index.json limpiado");

  console.log(`\n\nListo. Borrados: ${deleted} | Fallidos: ${failed}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
