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
}

export const BLUEPRINT_MAP: Record<ProductType, BlueprintConfig> = {
  tshirt: {
    // Blueprint 5 = Unisex Jersey Short Sleeve Tee — Monster Digital provider 29
    // 3 top-seller colors (Black, White, Midnight Navy) × S-2XL.
    // Variant IDs confirmed via `pnpm list:variants 5 29`.
    blueprintId: 5,
    printProviderId: 29,
    defaultVariants: [
      // Solid Black
      { id: 17427, price: 0 },  // S
      { id: 17428, price: 0 },  // M
      { id: 17429, price: 0 },  // L
      { id: 17430, price: 0 },  // XL
      { id: 17431, price: 0 },  // 2XL
      // Solid White
      { id: 17643, price: 0 },  // S
      { id: 17644, price: 0 },  // M
      { id: 17645, price: 0 },  // L
      { id: 17646, price: 0 },  // XL
      { id: 17647, price: 0 },  // 2XL
      // Solid Midnight Navy
      { id: 17562, price: 0 },  // S
      { id: 17563, price: 0 },  // M
      { id: 17564, price: 0 },  // L
      { id: 17565, price: 0 },  // XL
      { id: 17566, price: 0 },  // 2XL
    ],
    printPosition: "front",
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
