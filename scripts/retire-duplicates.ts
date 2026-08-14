/**
 * Retires the duplicate listings of the Father's Day batch: 14 listings went live for 5
 * concepts because the publisher had no per-concept cap yet (`max_variations_per_concept`
 * landed afterwards, default 1). The 5 best-scoring stay; the other 9 come down.
 *
 * Order of operations matters. Printify is asked to unpublish FIRST and only then to
 * delete. If DELETE alone were enough, the extra call is harmless; if DELETE were to leave
 * the Etsy listing orphaned, unpublishing first is what prevents 9 live listings that take
 * orders no Printify product can fulfil. Deleting first and checking after is the ordering
 * that cannot be undone.
 *
 * Safety:
 *   - Dry-run by default; `--apply` is required to touch anything.
 *   - `--limit N` stops after N products, so the first one can be verified before the rest.
 *   - Reads each product back before and after, and reports what actually changed.
 *   - Never touches the 5 keepers; their ids are listed here so a typo in the target list
 *     is caught by an assertion instead of by a deleted listing.
 *
 * Usage:
 *   pnpm tsx scripts/retire-duplicates.ts                    # dry run, shows the plan
 *   pnpm tsx scripts/retire-duplicates.ts --apply --limit 1   # retire one, then verify
 *   pnpm tsx scripts/retire-duplicates.ts --apply             # the rest
 */
import axios from "axios";
import { getConfig } from "../src/lib/config.js";
import { env } from "../src/lib/env.js";
import { getProduct, deleteProduct } from "../src/lib/printify.js";

const APPLY = process.argv.includes("--apply");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

/** Printify product id → the Etsy listing it published, for the record. */
const TARGETS: Array<{ product: string; listing: string }> = [
  { product: "6a25fc4c7045a9f7e00d0600", listing: "4518149462" },
  { product: "6a25fc9c7045a9f7e00d0614", listing: "4518150543" },
  { product: "6a25fd142156f3c45c06e4a6", listing: "4518148946" },
  { product: "6a25fd40b53ac8fe5807a0cd", listing: "4518148880" },
  { product: "6a25fd60f8a4dae19d01c03d", listing: "4518150159" },
  { product: "6a25fd8a5200244d290e01e4", listing: "4518149995" },
  { product: "6a25fdf278d569a38806ca92", listing: "4518149639" },
  { product: "6a25fe1829769c27560fd4b4", listing: "4518149899" },
  { product: "6a25fe72737747193c08cf62", listing: "4518148160" },
];

/** The 5 that must survive. Guards against a copy-paste error in TARGETS. */
const KEEPERS = new Set([
  "6a25fceb8cfc4c731904abea", // 4518150625 Reel Cool Dad          9.50
  "6a25fcc878d569a38806ca53", // 4518149048 Just Resting My Eyes   8.80
  "6a25fdad7045a9f7e00d0665", // 4518148734 Powered by Dad Jokes   8.80
  "6a25fdd22d6a97fa8b0e1adf", // 4518148444 The Grillfather        8.75
  "6a25fe43b53ac8fe5807a0fe", // 4518148350 Dad Jokes Periodically 8.75
]);

const shopId = String(getConfig().publishing.shop_id);

const http = axios.create({
  baseURL: "https://api.printify.com/v1",
  headers: { Authorization: `Bearer ${env.PRINTIFY_API_TOKEN}` },
});

/** Axios errors carry the Authorization header verbatim — never log the raw object. */
function describe(e: unknown): string {
  const err = e as { response?: { status?: number; data?: unknown }; message?: string };
  if (err.response) return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`;
  return err.message ?? String(e);
}

interface Live {
  title?: string;
  visible?: boolean;
  is_locked?: boolean;
  external?: { id?: string; handle?: string };
}

async function main(): Promise<void> {
  const overlap = TARGETS.filter((t) => KEEPERS.has(t.product));
  if (overlap.length > 0) {
    console.error(`ABORTA: ${overlap.length} de los objetivos están en la lista de conservar.`);
    process.exit(1);
  }

  console.log(
    `\n🗑  Retirar duplicadas — shop ${shopId}` +
      `\n   objetivos: ${TARGETS.length}${LIMIT !== Infinity ? ` (limitado a ${LIMIT})` : ""}` +
      `\n   modo: ${APPLY ? "APPLY (unpublish + delete, IRREVERSIBLE)" : "DRY RUN (no toca nada)"}\n`
  );

  let done = 0;
  for (const t of TARGETS.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    console.log("─".repeat(78));

    let before: Live;
    try {
      before = (await getProduct(shopId, t.product)) as unknown as Live;
    } catch (e) {
      console.log(`${t.product} — no se pudo leer (¿ya borrado?): ${describe(e)}`);
      continue;
    }

    console.log(`${t.product}  (etsy ${t.listing})`);
    console.log(`  ${(before.title ?? "").slice(0, 68)}`);
    console.log(
      `  antes: visible=${before.visible} · lock=${before.is_locked} · ` +
        `etsy=${before.external?.id ?? "ninguna"}`
    );

    if (!APPLY) {
      console.log(`  → se despublicaría y se borraría`);
      continue;
    }

    try {
      await http.post(`/shops/${shopId}/products/${t.product}/unpublish.json`);
      console.log(`  unpublish... ✓`);
    } catch (e) {
      // Not fatal on its own: the delete below is the operation the user asked for. But it
      // IS the signal that the Etsy listing may survive, so it has to be loud.
      console.log(`  unpublish... ⚠️  ${describe(e)}`);
    }

    const mid = (await getProduct(shopId, t.product).catch(() => null)) as Live | null;
    if (mid) {
      console.log(
        `  tras unpublish: visible=${mid.visible} · etsy=${mid.external?.id ?? "ninguna (desconectada)"}`
      );
    }

    try {
      await deleteProduct(shopId, t.product);
      console.log(`  delete... ✓`);
    } catch (e) {
      console.log(`  delete... ❌ ${describe(e)}`);
      continue;
    }

    const after = await getProduct(shopId, t.product).catch(() => null);
    console.log(after === null ? `  ✅ ya no existe en Printify` : `  ⚠️  sigue existiendo`);
    done++;
  }

  console.log("─".repeat(78));
  if (APPLY) {
    console.log(`\n✅ Retirados: ${done}/${Math.min(TARGETS.length, LIMIT)}`);
    console.log(
      `\n⚠️  Comprueba en Etsy → Shop Manager → Listings que esas ${done} han desaparecido.\n` +
        `   La API de Etsy no está disponible desde aquí, así que esa mitad no se puede\n` +
        `   verificar por código.`
    );
  } else {
    console.log(`\nDry run. Nada tocado.\n   Primero uno: pnpm tsx scripts/retire-duplicates.ts --apply --limit 1`);
  }
  console.log();
}

main().catch((err) => {
  console.error("retire-duplicates failed:", describe(err));
  process.exit(1);
});
