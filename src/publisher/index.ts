/**
 * Publicador — crea drafts en Printify y genera un Etsy pack para publicación manual.
 * Uso: pnpm publish-drafts
 *
 * Lee diseños en approved/, sube imágenes a Printify, genera SEO con Gemini,
 * crea el producto como DRAFT en Printify y vuelca un pack JSON/MD con todo el copy
 * listo para copiar a Etsy o para publicar desde el dashboard de Printify.
 *
 * (No usa la API de Etsy — no requiere cuenta dev aprobada.)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import {
  getShops,
  uploadImageBase64,
  createProduct,
} from "../lib/printify.js";
import { generateSEO } from "./seo.js";
import { calculatePrice } from "./pricing.js";
import { BLUEPRINT_MAP } from "./blueprint-map.js";
import { writeEtsyPack, type EtsyPackEntry } from "./etsy-pack.js";
import type { DesignMetadata } from "../generator/types.js";

interface ApprovedDesign {
  meta: DesignMetadata;
  metaPath: string;
}

function findApprovedDesigns(): ApprovedDesign[] {
  const results: ApprovedDesign[] = [];

  function walk(dir: string) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === "metadata.json") {
        try {
          const meta = JSON.parse(readFileSync(full, "utf-8")) as DesignMetadata;
          if (meta.status === "approved") {
            results.push({ meta, metaPath: full });
          }
        } catch { /* skip */ }
      } else {
        try { if (readdirSync(full)) walk(full); } catch { /* not dir */ }
      }
    }
  }

  walk("approved");
  return results;
}

interface DraftedMeta extends DesignMetadata {
  printifyProductId?: string;
  draftedAt?: string;
}

function markDrafted(metaPath: string, meta: DesignMetadata, printifyId: string) {
  const updated: DraftedMeta = {
    ...meta,
    printifyProductId: printifyId,
    draftedAt: new Date().toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(updated, null, 2));
}

async function draftDesign(
  shopId: string,
  { meta, metaPath }: ApprovedDesign
): Promise<EtsyPackEntry | null> {
  const blueprint = BLUEPRINT_MAP[meta.product];

  // Resolve image: prefer noBg (tshirts), then meta.files.original, then fallback to
  // resized.png in same dir (covers metadata pointing to a stale filename).
  const candidates = [
    meta.product === "tshirt" ? meta.files.noBg : undefined,
    meta.files.original,
    join(dirname(meta.files.original), "resized.png"),
  ].filter((p): p is string => !!p);

  const imagePath = candidates.find((p) => existsSync(p));
  if (!imagePath) {
    throw new Error(`Image not found. Tried: ${candidates.join(", ")}`);
  }

  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");

  process.stdout.write("    Uploading image to Printify... ");
  const uploaded = await uploadImageBase64(`${meta.id}.png`, base64);
  console.log(`✓ (${uploaded.id})`);

  const pricing = calculatePrice(meta.product, { marginPercent: 50 });
  const priceInCents = Math.round(pricing.suggestedPrice * 100);

  process.stdout.write("    Generating SEO metadata... ");
  const seo = await generateSEO(meta, [], pricing.suggestedPrice);
  console.log(`✓ "${seo.title.slice(0, 60)}..."`);

  process.stdout.write("    Creating Printify DRAFT... ");
  const product = await createProduct({
    shopId,
    title: seo.title,
    description: seo.description,
    blueprintId: blueprint.blueprintId,
    printProviderId: blueprint.printProviderId,
    variants: blueprint.defaultVariants.map((v) => ({
      id: v.id,
      price: priceInCents,
      is_enabled: true,
    })),
    printAreas: [
      {
        variant_ids: blueprint.defaultVariants.map((v) => v.id),
        placeholders: [
          {
            position: blueprint.printPosition,
            images: [
              { id: uploaded.id, x: 0.5, y: 0.5, scale: 1, angle: 0 },
            ],
          },
        ],
      },
    ],
  });
  console.log(`✓ (${product.id})`);

  // Product stays as DRAFT in Printify — no auto-publish to Etsy.
  markDrafted(metaPath, meta, product.id);

  return {
    designId: meta.id,
    niche: meta.niche,
    product: meta.product,
    printifyProductId: product.id,
    title: seo.title,
    description: seo.description,
    tags: seo.tags ?? [],
    suggestedPrice: pricing.suggestedPrice,
  };
}

async function main() {
  const approved = findApprovedDesigns();

  if (approved.length === 0) {
    console.log("\n⚠️  No hay diseños aprobados para publicar.");
    console.log("   Revisa diseños primero: pnpm review\n");
    process.exit(0);
  }

  const shops = await getShops();
  // Prefer the Etsy-linked shop; fall back to first available
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) {
    console.error("No Printify shop found. Vincula tu tienda en Printify primero.");
    process.exit(1);
  }
  if (shop.sales_channel !== "etsy") {
    console.warn(`⚠️  Ninguna tienda Etsy vinculada — usando "${shop.title}" (${shop.sales_channel}).`);
  }

  console.log(`\n🚀 Creando ${approved.length} drafts en "${shop.title}"\n`);
  console.log("─".repeat(60));

  const packEntries: EtsyPackEntry[] = [];
  const stats = { drafted: 0, failed: 0 };

  for (let i = 0; i < approved.length; i++) {
    const item = approved[i] as ApprovedDesign;
    console.log(`\n  [${i + 1}/${approved.length}] ${item.meta.id}`);

    try {
      const entry = await draftDesign(shop.id, item);
      if (entry) {
        packEntries.push(entry);
        stats.drafted++;
      }
    } catch (err) {
      console.error(`    ❌ Error: ${err instanceof Error ? err.message : err}`);
      stats.failed++;
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\n✅ Drafts creados: ${stats.drafted}`);
  if (stats.failed > 0) console.log(`   Errores: ${stats.failed}`);

  if (packEntries.length > 0) {
    const packPath = writeEtsyPack(packEntries);
    console.log(`\n📦 Etsy pack: ${packPath}`);
    console.log("\nSiguiente paso (manual):");
    console.log("  A) Printify dashboard → Products → 'Publish' a tu tienda Etsy");
    console.log("  B) O abre el .md del pack y copia-pega título/descripción/tags en Etsy");
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Publisher failed:", err);
    process.exit(1);
  });
