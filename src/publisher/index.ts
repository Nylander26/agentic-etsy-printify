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
import { pathToFileURL } from "url";
import axios from "axios";
import { walkDesigns } from "../lib/design-store.js";
import {
  resolvePublishShop,
  uploadImageBase64,
  createProduct,
  getProduct,
  updateMockupSelection,
  disableUnavailableVariants,
  deleteProduct,
  setPersonalization,
  enableEconomyShipping,
} from "../lib/printify.js";
import { isDrafted, recordDraft } from "../lib/draft-index.js";
import { generateSEO } from "./seo.js";
import { calculatePrice } from "./pricing.js";
import { BLUEPRINT_MAP, tshirtVariantsForVariation } from "./blueprint-map.js";
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
  timeoutMs = 180_000,
  intervalMs = 5_000
): Promise<Awaited<ReturnType<typeof getProduct>>> {
  const deadline = Date.now() + timeoutMs;
  let last = await getProduct(shopId, productId);
  // Printify renders mockups incrementally AND auto-selects each as it appears, so a
  // naive "first non-zero" or "stable across one poll" check exits mid-render (we once
  // curated a product down to 1 photo). Require the count to hold steady for several
  // consecutive polls (~15s of no change) before concluding the render has settled.
  const STABLE_POLLS = 3;
  let prev = last.images?.length ?? 0;
  let stable = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await getProduct(shopId, productId);
    const count = last.images?.length ?? 0;
    if (count > 0 && count === prev) {
      if (++stable >= STABLE_POLLS) break;
    } else {
      stable = 0;
    }
    prev = count;
  }
  return last;
}

/**
 * Curates which mockups Printify pushes to Etsy. Printify renders ~1 mockup per garment
 * COLOR and auto-selects all of them; left alone, a 12-color product would exceed Etsy's
 * 10-photo cap. We wait for the render to settle, then select up to `max` mockups with
 * COLOR diversity (one per color first, default front always included). Returns the count.
 */
export async function selectDiverseMockups(
  shopId: string,
  productId: string,
  max = 10
): Promise<number> {
  const full = await waitForMockups(shopId, productId);
  if (!full.images?.length) return 0;

  // Mockups for one garment color share the same variant_ids. Group by color so the
  // round-robin spreads the selection across colors instead of stacking one color.
  const byColor = new Map<string, typeof full.images>();
  for (const img of full.images) {
    const key = [...(img.variant_ids ?? [])].sort((a, b) => a - b).join(",") || img.position || "front";
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key)!.push(img);
  }

  const selected: string[] = [];
  // Default mockup first if present
  const def = full.images.find((i) => i.is_default);
  if (def) selected.push(def.src);

  // Round-robin one per color until we hit max (or run out)
  const queues = [...byColor.values()].map((arr) => [...arr]);
  while (selected.length < max) {
    let added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next && !selected.includes(next.src)) {
        selected.push(next.src);
        added = true;
        if (selected.length >= max) break;
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

// Economy-shipping eligibility is per blueprint+provider — learned on the first reconcile.
const economyEligibleCache = new Map<string, boolean>();
const bpKey = (blueprintId: number, providerId: number) => `${blueprintId}:${providerId}`;

// Concept/title cues that imply a buyer-customizable (personalized) design.
const PERSONALIZATION_CUES =
  /personali[sz]|custom(?:ize|ise|ized|ised)?\b|custom name|add (?:your )?name|your name|monogram|name & number|name and number/i;

/** Whether to enable Etsy's "Personalize" option for this design. */
function isPersonalizable(meta: DesignMetadata, seoTitle: string): boolean {
  const cfg = getConfig().publishing.personalization;
  if (!cfg.enabled) return false;
  if (meta.personalizable === true) return true;       // explicit metadata flag wins
  if (meta.personalizable === false) return false;
  if (!cfg.auto_detect) return false;
  return PERSONALIZATION_CUES.test(`${meta.concept} ${meta.niche} ${seoTitle}`);
}

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
  // T-shirts get a 6-color set chosen by the design's variation (dark artwork → dark
  // garments, base/no-text → light garments) so every product yields 6 contrast-correct
  // color mockups. Other products use their blueprint default variants.
  const baseVariants =
    targetProduct === "tshirt" ? tshirtVariantsForVariation(meta.variation) : blueprint.defaultVariants;

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

  // Print placeholders — front always; add a back placeholder when this is a tshirt with a
  // dedicated back artwork (#5). Both placeholders share the same variant_ids → one product.
  const placeholders: Array<{
    position: string;
    images: Array<{ id: string; x: number; y: number; scale: number; angle: number }>;
  }> = [
    { position: blueprint.printPosition, images: [{ id: uploaded.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
  ];

  if (targetProduct === "tshirt" && blueprint.backPosition && meta.files.back && existsSync(meta.files.back)) {
    process.stdout.write("    Processing back artwork... ");
    let backBuffer: Buffer = readFileSync(meta.files.back);
    backBuffer = await removeBackground(backBuffer);
    backBuffer = await resizeForPrintify(backBuffer, targetProduct);
    backBuffer = await compressForUpload(backBuffer);
    const backUploaded = await uploadImageBase64(
      `${meta.id}-${targetProduct}-back.png`,
      backBuffer.toString("base64")
    );
    console.log(`✓ back (${backUploaded.id})`);
    placeholders.push({
      position: blueprint.backPosition,
      images: [{ id: backUploaded.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
    });
  }

  // Per-variation color sets differ between designs, so a cross-product "available
  // variants" cache can't be reused (it would wrongly drop a set it never reconciled).
  // We draft all intended variants and reconcile each product against provider stock
  // after creation instead.
  const key = bpKey(blueprint.blueprintId, blueprint.printProviderId);
  const intendedVariants = baseVariants;

  process.stdout.write("    Creating Printify DRAFT... ");
  const product = await createProduct({
    shopId,
    title: seo.title,
    description: seo.description,
    blueprintId: blueprint.blueprintId,
    printProviderId: blueprint.printProviderId,
    variants: intendedVariants.map((v) => ({
      id: v.id,
      price: priceInCents,
      is_enabled: true,
    })),
    printAreas: [
      {
        variant_ids: intendedVariants.map((v) => v.id),
        placeholders,
      },
    ],
  });
  console.log(`✓ (${product.id})`);

  // Stock reconcile (every product): Printify only exposes provider stock via the
  // product's variants. Disable any out-of-stock variant. If nothing sellable remains,
  // delete the draft instead of leaving a product nobody can buy.
  process.stdout.write("    Checking variant stock... ");
  const { available, disabled, economyEligible } = await disableUnavailableVariants(shopId, product.id);
  economyEligibleCache.set(key, economyEligible);
  const sellable = intendedVariants.filter((v) => available.has(v.id));
  if (sellable.length === 0) {
    console.log("✗ sin stock — borrando draft");
    await deleteProduct(shopId, product.id);
    return null;
  }
  console.log(
    disabled.length > 0
      ? `✓ ${sellable.length}/${intendedVariants.length} con stock (${disabled.length} deshabilitadas)`
      : "✓ todas con stock"
  );

  // Cheapest shipping (US-only store): enable Printify economy shipping when eligible.
  if (getConfig().publishing.prefer_economy_shipping && economyEligibleCache.get(key)) {
    process.stdout.write("    Enabling economy shipping... ");
    try {
      await enableEconomyShipping(shopId, product.id);
      console.log("✓");
    } catch (err) {
      console.log(`SKIP (${err instanceof Error ? err.message : err})`);
    }
  }

  // Mockup selection is deferred to a SECOND pass after all products are created —
  // Printify renders mockups asynchronously (often >1 min), so waiting inline here
  // both stalled creation and fired a storm of polling GETs that returned 0 mockups.

  // Enable Etsy "Personalize" for custom-text designs so buyers can submit their text.
  if (isPersonalizable(meta, seo.title)) {
    process.stdout.write("    Enabling personalization... ");
    const pcfg = getConfig().publishing.personalization;
    try {
      await setPersonalization(shopId, product.id, {
        instructions: pcfg.instructions,
        buyerResponseLimit: pcfg.buyer_response_limit,
      });
      console.log("✓");
    } catch (err) {
      console.log(`SKIP (${err instanceof Error ? err.message : err})`);
    }
  }

  // Product stays as DRAFT in Printify — no auto-publish to Etsy.
  appendDraft(metaPath, meta, targetProduct, product.id);
  recordDraft({
    designId: meta.id,
    product: targetProduct,
    printifyProductId: product.id,
    title: seo.title,
  });

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

/**
 * Drafts every approved design into Printify and writes the Etsy pack.
 * Shared by `pnpm publish-drafts` (main below) and the full `pnpm pipeline` so both
 * use the SAME robust path: pinned/Etsy shop selection, draft-index dedup, fan-out
 * composition safety, stock reconcile and mockups. Returns run stats.
 */
export async function publishApproved(): Promise<{ drafted: number; failed: number; skipped: number }> {
  const allApproved = findApprovedDesigns();

  if (allApproved.length === 0) {
    console.log("\n⚠️  No hay diseños aprobados para publicar.");
    console.log("   Revisa diseños primero: pnpm review\n");
    return { drafted: 0, failed: 0, skipped: 0 };
  }

  // Respect the per-run cap (the draft-index dedup means already-drafted designs are
  // skipped, so this bounds *new* drafts created in one run).
  const approved = allApproved.slice(0, getConfig().publishing.max_publish_per_run);

  const shop = await resolvePublishShop(getConfig().publishing.shop_id);

  const fanOut = getConfig().publishing.fan_out_products ?? [];
  // A design's artwork is composed for ONE layout: mugs are wide seamless wrap-arounds
  // (art bleeds to the edges); t-shirts/posters are centered/portrait. Reusing a mug
  // wrap on a t-shirt prints cut-off/wrong (the "Grillfather" bug). Only fan a design
  // out to products in its own composition family; cross-family needs its own artwork.
  const COMPOSITION_FAMILY: Record<ProductType, "centered" | "wrap"> = {
    tshirt: "centered",
    poster: "centered",
    mug: "wrap",
  };
  const targetsFor = (meta: DesignMetadata): ProductType[] => {
    const family = COMPOSITION_FAMILY[meta.product];
    const compatible = fanOut.filter((p) => COMPOSITION_FAMILY[p] === family);
    return [...new Set<ProductType>([meta.product, ...compatible])];
  };
  const incompatibleFanOut = (meta: DesignMetadata): ProductType[] => {
    const family = COMPOSITION_FAMILY[meta.product];
    return fanOut.filter((p) => COMPOSITION_FAMILY[p] !== family && p !== meta.product);
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
    const skippedTargets = incompatibleFanOut(item.meta);
    if (skippedTargets.length > 0) {
      console.log(`    (fan-out) omito ${skippedTargets.join(", ")} — arte ${item.meta.product} (composición incompatible)`);
    }

    for (const targetProduct of targets) {
      const priorDraft = isDrafted(item.meta.id, targetProduct);
      if (alreadyDraftedFor(item.meta, targetProduct) || priorDraft) {
        const where = priorDraft ? ` (índice: ${priorDraft.printifyProductId})` : "";
        console.log(`    · ${targetProduct}: already drafted — skip${where}`);
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
        const n = await selectDiverseMockups(shop.id, entry.printifyProductId, 10);
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

  return { drafted: stats.drafted, failed: stats.failed, skipped: stats.skipped };
}

// Only auto-run when invoked directly (pnpm publish-drafts), not when imported by the pipeline.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  publishApproved()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Publisher failed:", err);
      process.exit(1);
    });
}
