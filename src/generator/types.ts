export type ProductType = "tshirt" | "mug" | "poster";

export type VariationKind = "base" | "dark" | "no-text";

export interface DesignMetadata {
  id: string;                   // e.g. "funny-cat-001-base"
  niche: string;
  concept: string;
  style: string;
  product: ProductType;
  variation: VariationKind;
  prompt: string;               // final prompt sent to image model
  status: "pending-review" | "approved" | "rejected";
  createdAt: string;
  files: {
    original: string;           // relative path from project root
    noBg?: string;              // only for tshirt
  };
}

// Printify minimum dimensions per product type
export const PRINTIFY_DIMENSIONS: Record<ProductType, { width: number; height: number }> = {
  tshirt: { width: 4500, height: 5400 },  // DTG standard
  mug:    { width: 2700, height: 1050 },  // wrap-around
  poster: { width: 4800, height: 6000 },  // 16×20 equivalent
};

// Gemini generates 1024×1024 — we upscale with sharp
export const GEMINI_OUTPUT_SIZE = 1024;
