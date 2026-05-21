export type ProductType = "tshirt" | "mug" | "poster";

export type VariationKind = "base" | "dark" | "no-text" | "minimal";

export type DesignStatus =
  | "pending-validation"   // generated, awaiting AI validator
  | "pending-review"       // validator passed (approved/borderline) or user force-approved
  | "approved"             // user approved in manual review
  | "rejected";            // validator + user agreed to drop, or user rejected in review

export interface NicheContext {
  keyword: string;
  demandScore: number;
  competitionScore: number;
  topTitles: string[];
  topTags: string[];
  avgPrice: number;
  trendDirection: "rising" | "stable" | "declining";
  marketplaceSource: "apify" | "none";
}

export interface ValidationScores {
  nicheRelevance: number;     // 1-10
  trendAlignment: number;     // 1-10
  commercialAppeal: number;   // 1-10
  printability: number;       // 1-10
  overall: number;            // 1-10
}

export interface ValidationResult {
  verdict: "approved" | "borderline" | "rejected";
  scores: ValidationScores;
  reasons: {
    strengths: string[];
    concerns: string[];
    blockers: string[];       // populated when verdict = "rejected"
  };
  suggestedImprovements: string[];  // feed into regeneration prompt
  evaluatedAt: string;
  model: string;
}

export interface DesignMetadata {
  id: string;                   // e.g. "funny-cat-001-base"
  niche: string;
  concept: string;
  style: string;
  product: ProductType;
  variation: VariationKind;
  prompt: string;               // final prompt sent to image model
  status: DesignStatus;
  createdAt: string;
  files: {
    original: string;           // relative path from project root
    noBg?: string;              // only for tshirt
    back?: string;              // dedicated back-of-shirt artwork (tshirt only)
    backNoBg?: string;          // background-removed back artwork
  };
  nicheContext?: NicheContext;        // snapshot of research data — used by validator
  validation?: ValidationResult;      // last validator run
  regenerationCount?: number;         // number of times this concept has been regenerated
  parentDesignId?: string;            // when this is a regeneration of another design
  forceApproved?: boolean;            // user overrode a "rejected" verdict
  personalizable?: boolean;           // design accepts buyer custom text → enable Etsy "Personalize"
}

// Printify minimum dimensions per product type
export const PRINTIFY_DIMENSIONS: Record<ProductType, { width: number; height: number }> = {
  tshirt: { width: 4500, height: 5400 },  // DTG standard
  mug:    { width: 2700, height: 1050 },  // wrap-around
  poster: { width: 4800, height: 6000 },  // 16×20 equivalent
};

// Native Gemini output size now depends on gemini.image_size (1K=1024 … 4K=4096).
// Reference constant for the legacy 1K baseline.
export const GEMINI_OUTPUT_SIZE = 1024;
