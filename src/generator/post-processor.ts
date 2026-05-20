import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { ProductType, DesignMetadata } from "./types.js";
import { PRINTIFY_DIMENSIONS } from "./types.js";
import { getConfig } from "../lib/config.js";

/**
 * Removes near-white background by color-keying via sharp.
 * Sharp/libvips-only — avoids the @imgly ONNX path that segfaults on Windows.
 *
 * Strategy: any pixel where min(R,G,B) > HARD_WHITE → fully transparent.
 * Between SOFT_EDGE and HARD_WHITE → ramped alpha for anti-aliased edges.
 * Below SOFT_EDGE → kept fully opaque.
 *
 * Works well for AI-generated designs that already use a pure white backdrop
 * (which our prompts enforce). Does not preserve near-white design elements;
 * keep design palettes away from #F0F0F0+.
 */
export async function removeBackground(inputBuffer: Buffer): Promise<Buffer> {
  const SOFT_EDGE = 235; // start fading to transparent
  const HARD_WHITE = 250; // fully transparent at/above this

  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] as number;
    const g = out[i + 1] as number;
    const b = out[i + 2] as number;
    const minC = Math.min(r, g, b);
    if (minC >= HARD_WHITE) {
      out[i + 3] = 0;
    } else if (minC > SOFT_EDGE) {
      const ramp = 1 - (minC - SOFT_EDGE) / (HARD_WHITE - SOFT_EDGE);
      out[i + 3] = Math.round((out[i + 3] as number) * ramp);
    }
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// TODO (calidad — diferido, hablado con el usuario 2026-05-20):
// Hoy se hace upscale de 1024×1024 → dimensiones Printify (p.ej. póster 4800×6000) con
// interpolación de sharp. Eso NO agrega detalle real: agranda el raster nativo de Nano
// Banana, así que en remera/póster grandes la nitidez efectiva sigue siendo la de 1024.
// Pendiente: generar a mayor resolución de origen o pasar por un upscaler real
// (Real-ESRGAN / API de upscaling) ANTES de redimensionar.
// Upscale and fit to Printify target dimensions using sharp
export async function resizeForPrintify(
  inputBuffer: Buffer,
  product: ProductType
): Promise<Buffer> {
  const { width, height } = PRINTIFY_DIMENSIONS[product];

  // All products use `contain` — avoids the squash that happens when stretching a
  // 1024×1024 source to a non-square print area (notably mugs at ~2.57:1).
  // Mugs/posters get an opaque white padding background; tshirts keep transparency.
  return sharp(inputBuffer)
    .resize(width, height, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: product === "tshirt" ? 0 : 1 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** base64 inflates a buffer by ~4/3 — estimate the encoded body size. */
function base64Size(buf: Buffer): number {
  return Math.ceil(buf.length / 3) * 4;
}

/**
 * Prepares the upload payload, prioritising QUALITY: it first encodes a lossless,
 * full-color PNG (max compression). Flat / vector art compresses well even losslessly,
 * so most designs upload with zero quality loss. Only if the lossless PNG would still
 * exceed Printify's POST body limit (HTTP 413) does it fall back to progressively
 * stronger palette quantization (256 → 128 → 64 colors), logging a warning so it's
 * clear which images were degraded. Resolution is never changed; transparency is kept.
 *
 * NOTE: the images that *force* quantization are exactly those bloated by the naive
 * 1024→print upscale (see the TODO on `resizeForPrintify`). A real upscaler would let
 * every design stay lossless here.
 */
export async function compressForUpload(
  inputBuffer: Buffer,
  maxBase64Bytes = getConfig().publishing.max_upload_mb * 1_000_000
): Promise<Buffer> {
  const mb = (b: Buffer) => (base64Size(b) / 1_000_000).toFixed(1);
  const limitMb = (maxBase64Bytes / 1_000_000).toFixed(1);

  // Already within Printify's POST limit → upload the bytes AS-IS. The input is already a
  // compressionLevel-9 PNG (from resizeForPrintify); re-encoding it again is redundant AND
  // altered transparent t-shirt PNGs enough that Printify's DTG rejected them with HTTP 500.
  if (base64Size(inputBuffer) <= maxBase64Bytes) return inputBuffer;

  // Too big for the base64 body → quantize the palette progressively until it fits.
  const losslessMb = mb(inputBuffer);
  let best = inputBuffer;
  for (const colors of [256, 128, 64]) {
    best = await sharp(inputBuffer)
      .png({ palette: true, colors, dither: 1.0, compressionLevel: 9, effort: 10 })
      .toBuffer();
    if (base64Size(best) <= maxBase64Bytes) {
      console.log(`      ⚠️  lossless ${losslessMb}MB > ${limitMb}MB límite — cuantizada a ${colors} colores (${mb(best)}MB)`);
      return best;
    }
  }
  console.log(`      ⚠️  lossless ${losslessMb}MB — cuantizada al máximo (64 colores, ${mb(best)}MB), aún cerca del límite`);
  return best;
}

function validateResolution(buffer: Buffer, product: ProductType): void {
  // sharp can't check without loading — we trust our resize step produced correct dims
  // This is a placeholder for future checks (e.g. DPI validation)
  const { width, height } = PRINTIFY_DIMENSIONS[product];
  if (buffer.length < 10_000) {
    throw new Error(
      `Output file suspiciously small (${buffer.length} bytes) for ${product} (${width}×${height})`
    );
  }
}

export interface PostProcessResult {
  noBgPath?: string;
  resizedOriginalPath: string;
}

export async function postProcess(
  metadata: DesignMetadata
): Promise<PostProcessResult> {
  const originalBuffer = readFileSync(metadata.files.original);
  const dir = dirname(metadata.files.original);
  const result: PostProcessResult = {
    resizedOriginalPath: metadata.files.original,
  };

  const removeBgEnabled = getConfig().generation.remove_background;

  if (metadata.product === "tshirt" && removeBgEnabled) {
    // Remove background first, then resize
    process.stdout.write("      removing background... ");
    const noBgBuffer = await removeBackground(originalBuffer);

    process.stdout.write("resizing... ");
    const resized = await resizeForPrintify(noBgBuffer, metadata.product);
    validateResolution(resized, metadata.product);

    const noBgPath = join(dir, "nobg.png");
    writeFileSync(noBgPath, resized);
    result.noBgPath = noBgPath;
    console.log("✓");
  } else {
    // Mug and poster: just resize, keep white background
    process.stdout.write("      resizing... ");
    const resized = await resizeForPrintify(originalBuffer, metadata.product);
    validateResolution(resized, metadata.product);

    const resizedPath = join(dir, "resized.png");
    writeFileSync(resizedPath, resized);
    result.resizedOriginalPath = resizedPath;
    console.log("✓");
  }

  return result;
}
