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
    blueprintId: 5,
    printProviderId: 29,        // Monster Digital (fast, good quality)
    defaultVariants: [
      { id: 17887, price: 0 },  // S
      { id: 17888, price: 0 },  // M
      { id: 17889, price: 0 },  // L
      { id: 17890, price: 0 },  // XL
      { id: 17891, price: 0 },  // 2XL
    ],
    printPosition: "front",
  },
  mug: {
    blueprintId: 459,
    printProviderId: 1,         // Printify Choice
    defaultVariants: [
      { id: 65306, price: 0 },  // 11oz white
    ],
    printPosition: "front",
  },
  poster: {
    blueprintId: 15,
    printProviderId: 1,
    defaultVariants: [
      { id: 1,  price: 0 },    // 12×16
      { id: 2,  price: 0 },    // 16×20
      { id: 3,  price: 0 },    // 18×24
    ],
    printPosition: "front",
  },
};
