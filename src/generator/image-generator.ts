import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { generateImage } from "../lib/gemini.js";
import { buildPrompt } from "./prompt-templates.js";
import type { ProductType, VariationKind, DesignMetadata } from "./types.js";

const VARIATIONS: VariationKind[] = ["base", "dark", "no-text"];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function designId(niche: string, concept: string, product: ProductType, variation: VariationKind, index: number): string {
  return `${slugify(niche)}-${String(index).padStart(3, "0")}-${product}-${variation}`;
}

export interface GenerateDesignInput {
  niche: string;
  concept: string;
  style: string;
  product: ProductType;
  outputDir: string; // e.g. output/2026-04-19/funny-cat
  index: number;     // sequential counter for unique IDs
}

export interface GenerateDesignResult {
  metadata: DesignMetadata;
  skipped: boolean;
  error?: string;
}

export async function generateDesign(
  input: GenerateDesignInput,
  variation: VariationKind = "base"
): Promise<GenerateDesignResult> {
  const id = designId(input.niche, input.concept, input.product, variation, input.index);
  const dir = join(input.outputDir, id);

  mkdirSync(dir, { recursive: true });

  let prompt: string;
  try {
    prompt = await buildPrompt(input.concept, input.style, input.product, variation);
  } catch (err) {
    return {
      metadata: {} as DesignMetadata,
      skipped: true,
      error: `Prompt build failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  let imageData: { base64: string; mimeType: string };
  try {
    imageData = await generateImage(prompt);
  } catch (err) {
    return {
      metadata: {} as DesignMetadata,
      skipped: true,
      error: `Image generation failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  const ext = imageData.mimeType.includes("png") ? "png" : "jpg";
  const originalPath = join(dir, `original.${ext}`);
  writeFileSync(originalPath, Buffer.from(imageData.base64, "base64"));

  const metadata: DesignMetadata = {
    id,
    niche: input.niche,
    concept: input.concept,
    style: input.style,
    product: input.product,
    variation,
    prompt,
    status: "pending-review",
    createdAt: new Date().toISOString(),
    files: { original: originalPath },
  };

  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));

  return { metadata, skipped: false };
}

// Generate all 3 variations for one concept
export async function generateAllVariations(
  input: GenerateDesignInput
): Promise<DesignMetadata[]> {
  const results: DesignMetadata[] = [];

  for (const variation of VARIATIONS) {
    process.stdout.write(
      `    [${variation}] "${input.concept.slice(0, 40)}" → ${input.product}... `
    );

    const result = await generateDesign(input, variation);

    if (result.skipped) {
      console.log(`SKIP (${result.error ?? "unknown"})`);
    } else {
      console.log(`✓ ${result.metadata.id}`);
      results.push(result.metadata);
    }
  }

  return results;
}
