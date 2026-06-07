import type { ProductType } from "../generator/types.js";

// Printify garment base costs in USD (mid-size, Monster Digital — verified live June 2026:
// BC3001 ranges $11.43 S → $16.10 2XL, ~$13.50 average). Flat retail across sizes, so we
// price off the average; small sizes earn a bit more, 2XL a bit less.
const BASE_COSTS: Record<ProductType, number> = {
  tshirt: 13.50,
  mug:    8.50,
  poster: 9.00,
};

// Etsy seller fees (US): 6.5% transaction + ~3% payment processing ≈ 9.5% of the order,
// plus ~$0.45 fixed ($0.20 listing + ~$0.25 processing fixed). Off-site ads (15%) are NOT
// included — they only apply to some sales and are the seller's toggle.
const ETSY_FEE_RATE = 0.095;
const ETSY_FEE_FIXED = 0.45;

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
  margin: number;      // NET margin percentage (after garment + shipping + Etsy fees)
  marginUSD: number;   // NET profit per sale in USD
}

/**
 * Retail price for a target NET margin — profit left after garment cost, absorbed shipping
 * (when free_shipping), and Etsy's %+fixed fees:
 *   price = (garment + shipping + fixedFee) / (1 - etsyRate - targetNetMargin)
 * then rounded UP to a psychological price point. With Monster's tee (~$13.50), free
 * economy shipping ($4.29) and targetNetMargin 0.11 this lands at $22.99 (~11% net).
 */
export function calculatePrice(
  product: ProductType,
  options: {
    targetNetMargin?: number;  // 0..1, profit after costs+fees (default 0.11)
    freeShipping?: boolean;    // bake shipping into price (default true)
    shippingCost?: number;     // absorbed shipping USD when freeShipping (default 4.29)
    nicheAvgPrice?: number;    // from research; only used as a soft sanity log upstream
    forcePrice?: number;       // override everything
  } = {}
): PricingResult {
  const {
    targetNetMargin = 0.11,
    freeShipping = true,
    shippingCost = 4.29,
    forcePrice,
  } = options;
  const baseCost = BASE_COSTS[product];

  const shipping = freeShipping ? shippingCost : 0;
  const netOf = (price: number) => price - baseCost - shipping - (ETSY_FEE_RATE * price + ETSY_FEE_FIXED);

  if (forcePrice !== undefined) {
    return {
      baseCost,
      suggestedPrice: forcePrice,
      margin: (netOf(forcePrice) / forcePrice) * 100,
      marginUSD: netOf(forcePrice),
    };
  }

  // Solve for price that yields the target NET margin, then round up to a price point.
  const denom = 1 - ETSY_FEE_RATE - targetNetMargin;
  const rawPrice = (baseCost + shipping + ETSY_FEE_FIXED) / Math.max(denom, 0.05);
  const suggestedPrice = nearestPricePoint(rawPrice);

  return {
    baseCost,
    suggestedPrice,
    margin: (netOf(suggestedPrice) / suggestedPrice) * 100,
    marginUSD: netOf(suggestedPrice),
  };
}
