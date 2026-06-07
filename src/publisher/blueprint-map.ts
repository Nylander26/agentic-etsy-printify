import type { ProductType } from "../generator/types.js";

/**
 * Printify blueprint + print provider defaults.
 * These IDs are stable — update if Printify changes their catalog.
 *
 * To discover IDs: pnpm test:apis (lists blueprints) or Printify API docs.
 * Blueprint IDs confirmed via Printify catalog (April 2026):
 *   5  = Unisex Jersey Short Sleeve Tee (Bella+Canvas 3001) — Monster Digital
 *   459 = White Glossy Mug (11oz) — Printify Choice
 *   15 = Enhanced Matte Paper Poster — Printify Choice
 */
export interface BlueprintConfig {
  blueprintId: number;
  printProviderId: number;
  // Default variant IDs to enable (sizes/colors) — override per product
  defaultVariants: Array<{ id: number; price: number }>;
  // Print area position name used in this blueprint
  printPosition: string;
  // Optional secondary print position (e.g. garment back) for designs that ship a back artwork
  backPosition?: string;
}

// ── T-shirt garment colors (Bella+Canvas 3001 / Monster Digital, prov 29) ──────
// Printify renders ONE front mockup per garment COLOR (verified live), so 6 colors
// = 6 listing photos → satisfies Etsy's "add 6 photos" nudge with real product
// shots (no Gemini, no distortion). Each color maps to its S-2XL variant ids
// (catalog-verified June 2026; some colors don't stock every size — stock reconcile
// trims the rest at publish time). Ink-vs-garment contrast matters, so colors are
// split into DARK and LIGHT sets and chosen by the design's variation:
//   - "dark"  variation = light/cream artwork  → DARK garments
//   - "base" / "no-text" = dark/colored artwork → LIGHT garments
const TSHIRT_COLORS = {
  // Dark garments (light artwork shows)
  black: [17427, 17428, 17429, 17430, 17431],
  navy: [17562, 17563, 17564, 17565, 17566],
  darkChocolate: [17463, 17464, 17465, 17466, 17467],
  heavyMetal: [17481, 17482, 17483, 17484, 17485], // charcoal
  cardinalRed: [64932, 64933, 64934, 64935, 64936],
  kellyGreen: [17508, 17509, 17510, 17511, 17512],
  // Light garments (dark artwork shows)
  white: [17644, 17645, 17646, 17647], // no S in catalog
  natural: [17499, 17500, 17501, 17502], // no 2XL
  cream: [17454, 17455, 17457, 17458], // no L
  lightPink: [17544, 17545, 17546, 17547, 17548],
  lightGrey: [17526, 17527, 17528], // S-L only
  heatherGrey: [17392, 17394, 17395], // M/XL/2XL only
} as const;

const TSHIRT_DARK_SET = [
  ...TSHIRT_COLORS.black,
  ...TSHIRT_COLORS.navy,
  ...TSHIRT_COLORS.darkChocolate,
  ...TSHIRT_COLORS.heavyMetal,
  ...TSHIRT_COLORS.cardinalRed,
  ...TSHIRT_COLORS.kellyGreen,
];
const TSHIRT_LIGHT_SET = [
  ...TSHIRT_COLORS.white,
  ...TSHIRT_COLORS.natural,
  ...TSHIRT_COLORS.cream,
  ...TSHIRT_COLORS.lightPink,
  ...TSHIRT_COLORS.lightGrey,
  ...TSHIRT_COLORS.heatherGrey,
];

/**
 * T-shirt variant ids (6 garment colors × available sizes) for a design variation.
 * "dark" artwork → dark garments; everything else (base/no-text) → light garments.
 */
export function tshirtVariantsForVariation(variation: string): Array<{ id: number; price: number }> {
  const ids = variation === "dark" ? TSHIRT_DARK_SET : TSHIRT_LIGHT_SET;
  return ids.map((id) => ({ id, price: 0 }));
}

export const BLUEPRINT_MAP: Record<ProductType, BlueprintConfig> = {
  tshirt: {
    // Blueprint 5 = Unisex Jersey Short Sleeve Tee — Monster Digital provider 29.
    // defaultVariants is the LIGHT set (fallback); the publisher overrides per
    // variation via tshirtVariantsForVariation() so each design gets 6 contrast-
    // correct colors = 6 mockups.
    blueprintId: 5,
    printProviderId: 29,
    defaultVariants: TSHIRT_LIGHT_SET.map((id) => ({ id, price: 0 })),
    printPosition: "front",
    backPosition: "back",
  },
  mug: {
    // Blueprint 68 = Mug 11oz — SPOKE Custom Products (only provider available)
    blueprintId: 68,
    printProviderId: 1,
    defaultVariants: [
      { id: 33719, price: 0 },  // 11oz
    ],
    printPosition: "front",
  },
  poster: {
    // Blueprint 282 = Matte Vertical Posters — Sensaria provider
    blueprintId: 282,
    printProviderId: 2,
    defaultVariants: [
      { id: 43135, price: 0 },  // 11" x 14"
      { id: 43138, price: 0 },  // 12" x 18"
      { id: 43141, price: 0 },  // 16" x 20"
      { id: 43144, price: 0 },  // 18" x 24"
    ],
    printPosition: "front",
  },
};
