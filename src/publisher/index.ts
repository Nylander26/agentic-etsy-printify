/**
 * Semana 4 entregable — publicador.
 * Uso: pnpm publish
 * Lee diseños en approved/, sube a Printify, genera SEO, publica en Etsy.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  getShops,
  uploadImageBase64,
  createProduct,
  publishProduct,
} from "../lib/printify.js";
import { generateSEO } from "./seo.js";
import { calculatePrice } from "./pricing.js";
import { BLUEPRINT_MAP } from "./blueprint-map.js";
import type { DesignMetadata } from "../generator/types.js";

// ── Find approved designs ─────────────────────────────────────────────────────

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

// ── Mark as published ─────────────────────────────────────────────────────────

interface PublishedMeta extends DesignMetadata {
  printifyProductId?: string;
  publishedAt?: string;
}

function markPublished(metaPath: string, meta: DesignMetadata, printifyId: string) {
  const updated: PublishedMeta = {
    ...meta,
    status: "approved", // keep approved — separate field tracks publish
    printifyProductId: printifyId,
    publishedAt: new Date().toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(updated, null, 2));
}

// ── Publish one design ────────────────────────────────────────────────────────

async function publishDesign(
  shopId: string,
  { meta, metaPath }: ApprovedDesign
): Promise<boolean> {
  const blueprint = BLUEPRINT_MAP[meta.product];

  // 1. Determine image to upload (prefer no-bg for tshirts)
  const imagePath = meta.product === "tshirt" && meta.files.noBg
    ? meta.files.noBg
    : meta.files.original;

  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");

  // 2. Upload image to Printify
  process.stdout.write("    Uploading image to Printify... ");
  const uploaded = await uploadImageBase64(`${meta.id}.png`, base64);
  console.log(`✓ (${uploaded.id})`);

  // 3. Calculate price
  const pricing = calculatePrice(meta.product, { marginPercent: 50 });
  const priceInCents = Math.round(pricing.suggestedPrice * 100);

  // 4. Generate SEO with Gemini
  process.stdout.write("    Generating SEO metadata... ");
  const seo = await generateSEO(meta, [], pricing.suggestedPrice);
  console.log(`✓ "${seo.title.slice(0, 60)}..."`);

  // 5. Create product in Printify
  process.stdout.write("    Creating Printify product... ");
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

  // 6. Publish to Etsy via Printify
  process.stdout.write("    Publishing to Etsy... ");
  await publishProduct(shopId, product.id);
  console.log("✓ LIVE");

  markPublished(metaPath, meta, product.id);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const approved = findApprovedDesigns();

  if (approved.length === 0) {
    console.log("\n⚠️  No hay diseños aprobados para publicar.");
    console.log("   Revisa diseños primero: pnpm review\n");
    process.exit(0);
  }

  // Get Printify shop ID
  const shops = await getShops();
  const shop = shops[0];
  if (!shop) {
    console.error("No Printify shop found. Connect your Etsy store in Printify first.");
    process.exit(1);
  }

  console.log(`\n🚀 Publicando ${approved.length} diseños en "${shop.title}"\n`);
  console.log("─".repeat(60));

  const stats = { published: 0, failed: 0 };

  for (let i = 0; i < approved.length; i++) {
    const item = approved[i] as ApprovedDesign;
    console.log(`\n  [${i + 1}/${approved.length}] ${item.meta.id}`);

    try {
      await publishDesign(shop.id, item);
      stats.published++;
    } catch (err) {
      console.error(`    ❌ Error: ${err instanceof Error ? err.message : err}`);
      stats.failed++;
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\n✅ Publicación completada:`);
  console.log(`   Publicados: ${stats.published}`);
  if (stats.failed > 0) console.log(`   Errores:    ${stats.failed}`);
  console.log();
}

main().catch((err) => {
  console.error("Publisher failed:", err);
  process.exit(1);
});
