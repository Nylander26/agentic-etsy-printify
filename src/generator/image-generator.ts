import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { generateImage } from "../lib/gemini.js";
import { buildPrompt, buildBackPrompt } from "./prompt-templates.js";
import { buildTypographySpec } from "./type-director.js";
import type { TypographySpec } from "./typography.js";
import { getConfig } from "../lib/config.js";
import { BudgetExceededError } from "../lib/budget.js";
import type {
  ProductType,
  VariationKind,
  DesignMetadata,
  NicheContext,
} from "./types.js";

const VARIATIONS: VariationKind[] = ["base", "dark", "no-text"];

// Native aspect ratio per product so the print resize doesn't letterbox:
//  - tshirt: centered + bg-removed → transparent padding is invisible, square is fine
//  - mug:    wide wrap-around (print ~2.57:1) → widest supported ratio avoids white side bars
//  - poster: portrait, matches the 4800×6000 (4:5) print area exactly → no padding
const PRODUCT_ASPECT_RATIO: Record<ProductType, string> = {
  tshirt: "1:1",
  mug: "21:9",
  poster: "4:5",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function designId(
  niche: string,
  concept: string,
  product: ProductType,
  variation: VariationKind,
  index: number,
  regenerationCount = 0
): string {
  const base = `${slugify(niche)}-${String(index).padStart(3, "0")}-${product}-${variation}`;
  return regenerationCount > 0 ? `${base}-r${regenerationCount}` : base;
}

export interface RegenerationContext {
  parentId: string;
  parentCount: number;          // regenerationCount of the parent (new = parentCount + 1)
  improvementHints: string[];   // from validator's suggestedImprovements
}

export interface GenerateDesignInput {
  niche: string;
  concept: string;
  style: string;
  product: ProductType;
  outputDir: string; // e.g. output/2026-04-19/funny-cat
  index: number;     // sequential counter for unique IDs
  nicheContext?: NicheContext;             // snapshot of research, persisted into metadata
  regenerationContext?: RegenerationContext; // present when this is a retry after validator rejection
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
  const regenCount = input.regenerationContext?.parentCount !== undefined
    ? input.regenerationContext.parentCount + 1
    : 0;
  const id = designId(input.niche, input.concept, input.product, variation, input.index, regenCount);
  const dir = join(input.outputDir, id);

  mkdirSync(dir, { recursive: true });

  // With vector typography on, the model draws artwork only and leaves the lower band
  // empty for the composited type. The "no-text" variation is illustration-only by
  // definition, so it keeps the full canvas and gets no type composited over it.
  const useTypography =
    getConfig().generation.typography.enabled && variation !== "no-text";

  let prompt: string;
  try {
    prompt = await buildPrompt(
      input.concept,
      input.style,
      input.product,
      variation,
      true,
      useTypography
    );
    // Append validator feedback when regenerating
    if (input.regenerationContext && input.regenerationContext.improvementHints.length > 0) {
      const hints = input.regenerationContext.improvementHints
        .map((h, i) => `${i + 1}. ${h}`)
        .join("\n");
      prompt += `\n\nIMPORTANT — incorporate these improvements (previous attempt was rejected by validator):\n${hints}`;
    }
  } catch (err) {
    return {
      metadata: {} as DesignMetadata,
      skipped: true,
      error: `Prompt build failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  let imageData: { base64: string; mimeType: string };
  try {
    imageData = await generateImage(prompt, { aspectRatio: PRODUCT_ASPECT_RATIO[input.product] });
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err; // budget abort must stop the run, not skip silently
    return {
      metadata: {} as DesignMetadata,
      skipped: true,
      error: `Image generation failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  const ext = imageData.mimeType.includes("png") ? "png" : "jpg";
  const originalPath = join(dir, `original.${ext}`);
  writeFileSync(originalPath, Buffer.from(imageData.base64, "base64"));

  // Optional dedicated back-of-shirt artwork (tshirt only). A failure here must not
  // discard the (already-generated) front — we just skip the back.
  let backPath: string | undefined;
  if (input.product === "tshirt" && getConfig().generation.tshirt_back_design) {
    try {
      const backPrompt = await buildBackPrompt(input.concept, input.style, variation);
      const backImg = await generateImage(backPrompt, { aspectRatio: PRODUCT_ASPECT_RATIO.tshirt });
      const backExt = backImg.mimeType.includes("png") ? "png" : "jpg";
      backPath = join(dir, `back.${backExt}`);
      writeFileSync(backPath, Buffer.from(backImg.base64, "base64"));
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.log(`      (back skipped: ${err instanceof Error ? err.message : err})`);
    }
  }

  // Lay out the words while the artwork is already on disk. A failure here degrades
  // the design to art-only rather than losing an image we have already paid for.
  let typography: TypographySpec | undefined;
  if (useTypography) {
    try {
      typography = await buildTypographySpec({
        concept: input.concept,
        style: input.style,
        niche: input.niche,
        variation,
      });
    } catch (err) {
      console.log(`      (type skipped: ${err instanceof Error ? err.message : err})`);
    }
  }

  const metadata: DesignMetadata = {
    id,
    niche: input.niche,
    concept: input.concept,
    style: input.style,
    product: input.product,
    variation,
    prompt,
    status: "pending-validation",
    createdAt: new Date().toISOString(),
    files: { original: originalPath, ...(backPath ? { back: backPath } : {}) },
    regenerationCount: regenCount,
    ...(typography ? { typography } : {}),
    ...(input.nicheContext ? { nicheContext: input.nicheContext } : {}),
    ...(input.regenerationContext ? { parentDesignId: input.regenerationContext.parentId } : {}),
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
