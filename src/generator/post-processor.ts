import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { ProductType, DesignMetadata } from "./types.js";
import { PRINTIFY_DIMENSIONS } from "./types.js";

// Remove background using @imgly/background-removal-node
// Lazy import — only loaded when needed (large ONNX model)
async function removeBackground(inputBuffer: Buffer): Promise<Buffer> {
  const { removeBackground: removeBg } = await import(
    "@imgly/background-removal-node"
  );

  const blob = new Blob([inputBuffer], { type: "image/png" });
  const resultBlob = await removeBg(blob, {
    model: "small",   // faster, good enough for most POD designs
    output: { format: "image/png", quality: 0.9 },
  });

  const arrayBuffer = await resultBlob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Upscale and fit to Printify target dimensions using sharp
async function resizeForPrintify(
  inputBuffer: Buffer,
  product: ProductType
): Promise<Buffer> {
  const { width, height } = PRINTIFY_DIMENSIONS[product];

  return sharp(inputBuffer)
    .resize(width, height, {
      fit: product === "mug" ? "fill" : "contain",
      background: { r: 255, g: 255, b: 255, alpha: product === "tshirt" ? 0 : 1 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
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

  if (metadata.product === "tshirt") {
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
