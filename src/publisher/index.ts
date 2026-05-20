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
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import axios from "axios";
import { walkDesigns } from "../lib/design-store.js";
import {
  getShops,
  uploadImageBase64,
  createProduct,
  getProduct,
  updateMockupSelection,
} from "../lib/printify.js";
import { generateSEO } from "./seo.js";
import { calculatePrice } from "./pricing.js";
import { BLUEPRINT_MAP } from "./blueprint-map.js";
import { writeEtsyPack, type EtsyPackEntry } from "./etsy-pack.js";
import type { DesignMetadata, ProductType } from "../generator/types.js";
import { resizeForPrintify, removeBackground, compressForUpload } from "../generator/post-processor.js";
import { getConfig } from "../lib/config.js";
import { upscaleBuffer, isUpscalerEnabled } from "../lib/upscaler.js";

interface ApprovedDesign {
  meta: DesignMetadata;
  metaPath: string;
}

function findApprovedDesigns(): ApprovedDesign[] {
  return walkDesigns("approved", (m) => m.status === "approved");
}

interface DraftRecord {
  product: ProductType;
  printifyProductId: string;
  draftedAt: string;
}

interface DraftedMeta extends DesignMetadata {
  drafts?: DraftRecord[];
}

/**
 * Polls getProduct until Printify has generated at least one mockup image
 * (mockup generation is async — the immediate response after createProduct
 * usually has `images: []`).
 */
async function waitForMockups(
  shopId: string,
  productId: string,
  timeoutMs = 150_000,
  intervalMs = 5_000
): Promise<Awaited<ReturnType<typeof getProduct>>> {
  const deadline = Date.now() + timeoutMs;
  let last = await getProduct(shopId, productId);
  while ((last.images?.length ?? 0) === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await getProduct(shopId, productId);
  }
  return last;
}

/**
 * Picks up to `target` diverse mockups (varying camera positions) and marks them
 * for sales-channel publishing. Always includes the default front mockup.
 * Returns number of mockups selected.
 */
async function selectDiverseMockups(
  shopId: string,
  productId: string,
  target: number
): Promise<number> {
  const full = await waitForMockups(shopId, productId);
  if (!full.images?.length) return 0;

  // Group by position so we get camera-angle diversity, not 6 nearly-identical shots.
  const byPosition = new Map<string, typeof full.images>();
  for (const img of full.images) {
    const pos = img.position || "front";
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(img);
  }

  const selected: string[] = [];
  // Default mockup first if present
  const def = full.images.find((i) => i.is_default);
  if (def) selected.push(def.src);

  // Round-robin one per position until we hit target
  const queues = [...byPosition.values()].map((arr) => [...arr]);
  while (selected.length < target) {
    let added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next && !selected.includes(next.src)) {
        selected.push(next.src);
        added = true;
        if (selected.length >= target) break;
      }
    }
    if (!added) break;
  }

  await updateMockupSelection(shopId, productId, selected);
  return selected.length;
}

function appendDraft(
  metaPath: string,
  meta: DesignMetadata,
  product: ProductType,
  printifyId: string
) {
  const existing = (meta as DraftedMeta).drafts ?? [];
  const updated: DraftedMeta = {
    ...meta,
    drafts: [...existing, { product, printifyProductId: printifyId, draftedAt: new Date().toISOString() }],
  };
  writeFileSync(metaPath, JSON.stringify(updated, null, 2));
}

function alreadyDraftedFor(meta: DesignMetadata, product: ProductType): boolean {
  return ((meta as DraftedMeta).drafts ?? []).some((d) => d.product === product);
}

/**
 * Resolves the best source image for a given target product.
 * For t-shirts prefer the background-removed version; for mug/poster prefer
 * the resized/original with background.
 */
// Cache upscaled source buffers within a run. Keyed by source path; cleared per design in
// main() so memory stays bounded (a design has at most ~2 distinct sources across its targets).
const upscaleCache = new Map<string, Buffer>();

function resolveSourceImage(meta: DesignMetadata, targetProduct: ProductType): string {
  const candidates =
    targetProduct === "tshirt"
      ? [meta.files.noBg, meta.files.original, join(dirname(meta.files.original), "resized.png")]
      : [join(dirname(meta.files.original), "resized.png"), meta.files.original, meta.files.noBg];

  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  throw new Error(`Source image not found. Tried: ${candidates.filter(Boolean).join(", ")}`);
}

async function draftDesign(
  shopId: string,
  { meta, metaPath }: ApprovedDesign,
  targetProduct: ProductType
): Promise<EtsyPackEntry | null> {
  const blueprint = BLUEPRINT_MAP[targetProduct];

  const sourcePath = resolveSourceImage(meta, targetProduct);
  let imageBuffer: Buffer = readFileSync(sourcePath);

  // Optional local AI upscale (real detail) — first, so bg-removal/resize operate on the
  // high-res image. Cached per source path so a design's fan-out targets (tshirt/mug/poster)
  // don't re-run the upscaler on the same image. Silent fallback when disabled/unavailable.
  if (isUpscalerEnabled()) {
    const cached = upscaleCache.get(sourcePath);
    if (cached) {
      imageBuffer = cached;
      console.log("    Upscale reusado de cache ✓");
    } else {
      process.stdout.write(`    Upscaling locally (realesrgan ×${getConfig().upscaler.scale})... `);
      try {
        imageBuffer = await upscaleBuffer(imageBuffer);
        upscaleCache.set(sourcePath, imageBuffer);
        console.log("✓");
      } catch (err) {
        console.log(`SKIP (${err instanceof Error ? err.message : err})`);
      }
    }
  }

  // For tshirt: ensure background is removed. We can't trust meta.files.noBg —
  // older approved designs were generated when bg-removal was disabled and the
  // "noBg" file may not exist or may still contain white. Always run the keyer.
  if (targetProduct === "tshirt") {
    process.stdout.write("    Removing background... ");
    imageBuffer = await removeBackground(imageBuffer);
    console.log("✓");
  }

  // Always normalize to the product's print dimensions (crisply downscales an upscaled
  // image; near-noop when the source is already at target size).
  process.stdout.write(`    Resizing for ${targetProduct}... `);
  imageBuffer = await resizeForPrintify(imageBuffer, targetProduct);
  console.log("✓");

  process.stdout.write("    Compressing for upload... ");
  imageBuffer = await compressForUpload(imageBuffer);
  const base64 = imageBuffer.toString("base64");
  console.log(`✓ (${(base64.length / 1024 / 1024).toFixed(1)}MB base64)`);

  process.stdout.write("    Uploading image to Printify... ");
  const uploaded = await uploadImageBase64(`${meta.id}-${targetProduct}.png`, base64);
  console.log(`✓ (${uploaded.id})`);

  const margin = getConfig().publishing.margin_percent;
  const pricing = calculatePrice(targetProduct, { marginPercent: margin });
  const priceInCents = Math.round(pricing.suggestedPrice * 100);

  process.stdout.write("    Generating SEO metadata... ");
  const seoMeta = { ...meta, product: targetProduct };
  const seo = await generateSEO(seoMeta, [], pricing.suggestedPrice);
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

  // Mockup selection is deferred to a SECOND pass after all products are created —
  // Printify renders mockups asynchronously (often >1 min), so waiting inline here
  // both stalled creation and fired a storm of polling GETs that returned 0 mockups.

  // Product stays as DRAFT in Printify — no auto-publish to Etsy.
  appendDraft(metaPath, meta, targetProduct, product.id);

  return {
    designId: meta.id,
    niche: meta.niche,
    product: targetProduct,
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

  const fanOut = getConfig().publishing.fan_out_products ?? [];
  const targetsFor = (meta: DesignMetadata): ProductType[] => {
    const set = new Set<ProductType>([meta.product, ...fanOut]);
    return [...set];
  };

  const totalDrafts = approved.reduce((acc, a) => acc + targetsFor(a.meta).length, 0);
  console.log(`\n🚀 Creando ${totalDrafts} drafts (${approved.length} diseños × productos) en "${shop.title}"\n`);
  console.log("─".repeat(60));

  const packEntries: EtsyPackEntry[] = [];
  const stats = { drafted: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < approved.length; i++) {
    const item = approved[i] as ApprovedDesign;
    upscaleCache.clear(); // bound memory: only reuse within this design's fan-out targets
    const targets = targetsFor(item.meta);
    console.log(`\n  [${i + 1}/${approved.length}] ${item.meta.id} → ${targets.join(", ")}`);

    for (const targetProduct of targets) {
      if (alreadyDraftedFor(item.meta, targetProduct)) {
        console.log(`    · ${targetProduct}: already drafted — skip`);
        stats.skipped++;
        continue;
      }
      console.log(`    · ${targetProduct}:`);
      try {
        const entry = await draftDesign(shop.id, item, targetProduct);
        if (entry) {
          packEntries.push(entry);
          stats.drafted++;
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response) {
          const body = typeof err.response.data === "string"
            ? err.response.data
            : JSON.stringify(err.response.data, null, 2);
          console.error(`      ❌ HTTP ${err.response.status}: ${err.message}`);
          console.error(`         Body: ${body.slice(0, 800)}`);
        } else {
          console.error(`      ❌ Error: ${err instanceof Error ? err.message : err}`);
        }
        stats.failed++;
      }
    }
  }

  // ── Second pass: select mockups now that Printify has had time to render them ──
  if (packEntries.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log(`\n🖼  Seleccionando mockups (${packEntries.length} productos, hasta 150s c/u si hace falta)...`);
    let withMockups = 0;
    for (const entry of packEntries) {
      process.stdout.write(`  ${entry.printifyProductId} (${entry.product})... `);
      try {
        const n = await selectDiverseMockups(shop.id, entry.printifyProductId, 6);
        if (n > 0) withMockups++;
        console.log(`✓ ${n} mockups`);
      } catch (err) {
        console.log(`SKIP (${err instanceof Error ? err.message : err})`);
      }
    }
    console.log(`  → ${withMockups}/${packEntries.length} con mockups seleccionados`);
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\n✅ Drafts creados: ${stats.drafted}`);
  if (stats.skipped > 0) console.log(`   Saltados (ya draft): ${stats.skipped}`);
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
