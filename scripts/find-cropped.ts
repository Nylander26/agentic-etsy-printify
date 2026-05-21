/**
 * Vision sweep: find t-shirt products whose artwork is wraparound / edge-bleed
 * (designed for a mug or full-bleed surface) and would be CROPPED when placed on a
 * t-shirt chest print area — the "Grillfather" defect (#6).
 *
 *   pnpm tsx scripts/find-cropped.ts            # READ-ONLY: classify + report + write cache
 *   pnpm tsx scripts/find-cropped.ts --apply    # also DELETE the flagged products in Printify
 *
 * Why only t-shirts get flagged: the fan-out reuses the SAME uploaded artwork across
 * tshirt/mug/poster. Wraparound art is CORRECT on a mug (it wraps) and on a poster
 * (full bleed) — it only crops badly on a tee's rectangular chest print. So we
 * classify each unique artwork once with Gemini Vision and flag only the tshirt
 * products built from a wraparound art. The report still lists everything.
 *
 * Resumable: classifications are cached in output/.wraparound-report.json keyed by
 * uploaded artwork id. If Gemini hits its daily quota mid-run, progress is saved and
 * a re-run picks up where it left off.
 *
 * Safety: --apply deletes BOTH drafts and PUBLISHED flagged products (user-authorized:
 * remove defective items even at the cost of listing age).
 */
import axios from "axios";
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getShops, deleteProduct } from "../src/lib/printify.js";
import { analyzeImage } from "../src/lib/gemini.js";
import { BLUEPRINT_MAP } from "../src/publisher/blueprint-map.js";
import type { ProductType } from "../src/generator/types.js";

const APPLY = process.argv.includes("--apply");
const REPORT_PATH = resolve("output/.wraparound-report.json");

const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}` },
});

// blueprint_id -> product type (reverse of BLUEPRINT_MAP)
const TYPE_BY_BLUEPRINT = new Map<number, ProductType>(
  (Object.entries(BLUEPRINT_MAP) as [ProductType, { blueprintId: number }][]).map(
    ([t, c]) => [c.blueprintId, t]
  )
);

interface Prod {
  id: string;
  title: string;
  blueprint_id: number;
  external: { id: string } | null;
  print_areas?: Array<{ placeholders?: Array<{ images?: Array<{ id: string; src?: string }> }> }>;
}

interface ArtImg { id: string; src: string }

/** Uploaded artwork (id + downloadable src) = print-area image with a real src. */
function artwork(p: Prod): ArtImg | null {
  const imgs = (p.print_areas ?? []).flatMap((a) => a.placeholders ?? []).flatMap((x) => x.images ?? []);
  const hit = imgs.find((i) => i.src && i.src.length > 0);
  return hit ? { id: hit.id, src: hit.src! } : null;
}

interface Classification { wraparound: boolean; reason: string; src: string }
type Cache = Record<string, Classification>;

function loadCache(): Cache {
  if (!existsSync(REPORT_PATH)) return {};
  try {
    return (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as { classifications?: Cache }).classifications ?? {};
  } catch {
    return {};
  }
}

function saveCache(c: Cache): void {
  writeFileSync(REPORT_PATH, JSON.stringify({ classifications: c, updated: new Date().toISOString() }, null, 2));
}

const VISION_PROMPT = `You are inspecting a print-on-demand ARTWORK file (the raw design, not a product photo).
Decide if this art is "wraparound / edge-bleed": meaningful content — ESPECIALLY TEXT — runs into or is cut off by the edges of the canvas, OR the composition is clearly built to wrap around a mug / fill a full-bleed surface rather than sit as a centered, self-contained graphic.
Such art looks CORRECT on a mug (it wraps) but gets visibly CROPPED/cut when placed on a t-shirt chest, where the print area is a centered rectangle with margins.
A clean centered design with clear empty margin around all content is NOT wraparound.
Return strict JSON: {"wraparound": boolean, "reason": "<short reason>"}.`;

async function classify(art: ArtImg): Promise<Classification> {
  const res = await axios.get<ArrayBuffer>(art.src, { responseType: "arraybuffer" });
  const mime = (res.headers["content-type"] as string | undefined) ?? "image/png";
  const base64 = Buffer.from(res.data).toString("base64");
  const out = await analyzeImage<{ wraparound: boolean; reason: string }>(base64, mime, VISION_PROMPT);
  return { wraparound: !!out.wraparound, reason: out.reason ?? "", src: art.src };
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
  const shops = await getShops();
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) throw new Error("No Printify shop found");

  const products = await fetchAll(shop.id);
  const published = products.filter((p) => p.external);
  console.log(`Printify "${shop.title}": ${products.length} productos (${published.length} publicados, ${products.length - published.length} drafts).`);

  // Map each product to its artwork + type
  type Entry = { prod: Prod; type: ProductType | undefined; art: ArtImg | null };
  const entries: Entry[] = products.map((p) => ({ prod: p, type: TYPE_BY_BLUEPRINT.get(p.blueprint_id), art: artwork(p) }));

  // Unique arts that appear on at least one t-shirt → the only ones we can act on.
  const tshirtArtIds = new Set<string>();
  for (const e of entries) if (e.type === "tshirt" && e.art) tshirtArtIds.add(e.art.id);
  const artSrcById = new Map<string, ArtImg>();
  for (const e of entries) if (e.art && tshirtArtIds.has(e.art.id)) artSrcById.set(e.art.id, e.art);

  const counts = { tshirt: 0, mug: 0, poster: 0, unknown: 0 };
  for (const e of entries) counts[(e.type ?? "unknown") as keyof typeof counts]++;
  console.log(`Por tipo → tshirt:${counts.tshirt} mug:${counts.mug} poster:${counts.poster} otros:${counts.unknown}`);
  console.log(`Artes únicos en camisetas a clasificar: ${tshirtArtIds.size}`);

  // Classify (resumable)
  const cache = loadCache();
  let done = 0, called = 0;
  for (const [id, art] of artSrcById) {
    if (cache[id]) { done++; continue; }
    try {
      cache[id] = await classify(art);
      saveCache(cache);
      called++; done++;
      process.stdout.write(`\r  clasificados ${done}/${tshirtArtIds.size} (${called} nuevas llamadas)`);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: unknown }; message?: string };
      const status = err.response?.status;
      saveCache(cache);
      if (status === 429) {
        console.log(`\n⚠ Cuota/limite de Gemini alcanzado (429). Progreso guardado (${done}/${tshirtArtIds.size}). Re-ejecuta más tarde para continuar.`);
        break;
      }
      console.error(`\n  ✗ arte ${id}: ${status ?? ""} ${err.message ?? e}`);
    }
  }
  console.log("");

  // Flag t-shirt products whose art is classified wraparound
  const flagged = entries.filter((e) => e.type === "tshirt" && e.art && cache[e.art.id]?.wraparound);
  const flaggedDrafts = flagged.filter((e) => !e.prod.external);
  const flaggedPublished = flagged.filter((e) => e.prod.external);
  const unclassified = [...tshirtArtIds].filter((id) => !cache[id]).length;

  console.log(`\n── Resultado ──`);
  console.log(`Camisetas con arte wraparound (defectuosas): ${flagged.length}  (${flaggedDrafts.length} drafts, ${flaggedPublished.length} publicadas)`);
  if (unclassified > 0) console.log(`⚠ ${unclassified} artes de camiseta SIN clasificar todavía (cuota) — vuelve a correr para completarlas.`);
  flagged.slice(0, 60).forEach((e) => {
    const tag = e.prod.external ? "PUB " : "draft";
    console.log(`  [${tag}] ${e.prod.id}  ${e.prod.title.slice(0, 55)}  · ${cache[e.art!.id]?.reason.slice(0, 50)}`);
  });

  if (!APPLY) {
    console.log(`\n(READ-ONLY) Re-ejecuta con --apply para BORRAR las ${flagged.length} camisetas defectuosas (drafts + publicadas).`);
    console.log(`Reporte/caché: ${REPORT_PATH}`);
    return;
  }

  console.log(`\n--apply: borrando ${flagged.length} camisetas defectuosas...`);
  let deleted = 0;
  for (const e of flagged) {
    try {
      await deleteProduct(shop.id, e.prod.id);
      deleted++;
      process.stdout.write(`\r  borradas ${deleted}/${flagged.length}`);
    } catch (e2: unknown) {
      const err = e2 as { response?: { status?: number }; message?: string };
      console.error(`\n  ✗ ${e.prod.id}: ${err.response?.status ?? ""} ${err.message ?? e2}`);
    }
  }
  console.log(`\n✓ ${deleted} productos defectuosos borrados.`);
}

main().catch((e) => {
  console.error("FAILED:", e?.response?.status, e?.response?.data ?? e?.message);
  process.exit(1);
});
