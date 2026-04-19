import type { ProductType } from "../generator/types.js";

// Printify base costs in USD (approximate, varies by provider)
const BASE_COSTS: Record<ProductType, number> = {
  tshirt: 12.00,
  mug:    8.50,
  poster: 9.00,
};

// Psychological price points — we round up to the nearest one
const PRICE_POINTS = [9.99, 12.99, 14.99, 17.99, 19.99, 22.99, 24.99, 27.99, 29.99, 34.99, 39.99, 44.99, 49.99];

function nearestPricePoint(raw: number): number {
  // Find the first price point >= raw, or the last one if raw exceeds all
  const match = PRICE_POINTS.find((p) => p >= raw);
  return match ?? (PRICE_POINTS[PRICE_POINTS.length - 1] as number);
}

export interface PricingResult {
  baseCost: number;
  suggestedPrice: number;
  margin: number;      // percentage
  marginUSD: number;
}

export function calculatePrice(
  product: ProductType,
  options: {
    marginPercent?: number;    // default 50
    nicheAvgPrice?: number;    // from research, used to sanity-check
    forcePrice?: number;       // override everything
  } = {}
): PricingResult {
  const { marginPercent = 50, nicheAvgPrice, forcePrice } = options;
  const baseCost = BASE_COSTS[product];

  if (forcePrice !== undefined) {
    return {
      baseCost,
      suggestedPrice: forcePrice,
      margin: ((forcePrice - baseCost) / forcePrice) * 100,
      marginUSD: forcePrice - baseCost,
    };
  }

  // Start with margin-based price
  const rawPrice = baseCost / (1 - marginPercent / 100);

  // If we have niche data, don't go above 110% of competitor avg (stay competitive)
  const cappedPrice = nicheAvgPrice
    ? Math.min(rawPrice, nicheAvgPrice * 1.1)
    : rawPrice;

  // Ensure we always make at least $3 profit
  const flooredPrice = Math.max(cappedPrice, baseCost + 3);

  const suggestedPrice = nearestPricePoint(flooredPrice);

  return {
    baseCost,
    suggestedPrice,
    margin: ((suggestedPrice - baseCost) / suggestedPrice) * 100,
    marginUSD: suggestedPrice - baseCost,
  };
}
