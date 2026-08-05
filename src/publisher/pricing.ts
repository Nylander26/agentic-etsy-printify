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
// plus ~$0.45 fixed ($0.20 listing + ~$0.25 processing fixed). Off-site ads are added on
// top when enabled: 15% while the shop bills under $10k/yr (optional at that tier), 12%
// above it (mandatory) — note the rate goes DOWN as volume goes up.
//
// Verified against Printify's own dashboard 2026-08-05, size L: retail $29.99, production
// $14.09, free Economy shipping $4.29, off-site ads 15% →
//   29.99 − 14.09 − 4.29 − (0.245 × 29.99 + 0.45) = $3.81
// which is the profit Printify itself reports for that row, to the cent.
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
  /** Set when the price could not honor the target — see `warning`. */
  clamped?: boolean;
  /** Human-readable reason the price is not what the config asked for. */
  warning?: string;
}

/**
 * Retail price for a target NET margin — profit left after garment cost, absorbed shipping
 * (when free_shipping), and Etsy's %+fixed fees:
 *   price = (garment + shipping + fixedFee) / (1 - etsyRate - targetNetMargin)
 * then rounded UP to a psychological price point. With Monster's tee (~$13.50), free
 * Economy shipping ($4.29), 15% off-site ads and targetNetMargin 0.14 this lands at
 * $29.99 (~14.7% net on the average size).
 */
export function calculatePrice(
  product: ProductType,
  options: {
    targetNetMargin?: number;  // 0..1, profit after costs+fees (default 0.14)
    freeShipping?: boolean;    // bake shipping into price (default true)
    shippingCost?: number;     // absorbed shipping USD when freeShipping (default 4.29 Economy)
    offsiteAdsRate?: number;   // extra Etsy off-site ads fee, e.g. 0.15 (default 0)
    nicheAvgPrice?: number;    // from research; only used as a soft sanity log upstream
    forcePrice?: number;       // override everything
    /** Size-specific production cost. BASE_COSTS is a flat average across sizes; pass this
     *  to reconcile against a single Printify row (S is cheaper, 2XL dearer). */
    baseCostOverride?: number;
  } = {}
): PricingResult {
  const {
    targetNetMargin = 0.14,
    freeShipping = true,
    shippingCost = 4.29,
    offsiteAdsRate = 0,
    forcePrice,
    baseCostOverride,
  } = options;
  const baseCost = baseCostOverride ?? BASE_COSTS[product];

  // Off-site ads only charge on attributed sales, but pricing for them (worst case) means
  // organic sales just earn more — a safe, conservative price floor.
  const feeRate = ETSY_FEE_RATE + offsiteAdsRate;
  const shipping = freeShipping ? shippingCost : 0;
  const netOf = (price: number) => price - baseCost - shipping - (feeRate * price + ETSY_FEE_FIXED);

  if (forcePrice !== undefined) {
    return withSolvencyCheck({
      baseCost,
      suggestedPrice: forcePrice,
      margin: (netOf(forcePrice) / forcePrice) * 100,
      marginUSD: netOf(forcePrice),
    });
  }

  // Solve for price that yields the target NET margin, then round up to a price point.
  const denom = 1 - feeRate - targetNetMargin;
  const rawPrice = (baseCost + shipping + ETSY_FEE_FIXED) / Math.max(denom, 0.05);
  const suggestedPrice = nearestPricePoint(rawPrice);

  // `nearestPricePoint` falls back to the highest point when the solved price exceeds the
  // ladder, and `Math.max(denom, 0.05)` caps an impossible target instead of failing. Both
  // are silent: an over-ambitious `target_net_margin` used to come back as a normal-looking
  // price that simply doesn't earn what was asked — or loses money — with nothing said.
  const topPoint = PRICE_POINTS[PRICE_POINTS.length - 1] as number;
  const clampedByLadder = rawPrice > topPoint;

  return withSolvencyCheck({
    baseCost,
    suggestedPrice,
    margin: (netOf(suggestedPrice) / suggestedPrice) * 100,
    marginUSD: netOf(suggestedPrice),
    ...(clampedByLadder
      ? {
          clamped: true,
          warning:
            `precio objetivo $${rawPrice.toFixed(2)} supera el tope de la escala ($${topPoint.toFixed(2)}); ` +
            `se vende a $${suggestedPrice.toFixed(2)} y el margen real queda por debajo del objetivo`,
        }
      : {}),
  });
}

/**
 * Last line of defense: a price that does not cover cost + fees is never a rounding
 * detail, it is a loss on every sale. Surfaced on the result (and logged once) rather
 * than thrown, so a single bad product config can't abort a whole publish run.
 */
function withSolvencyCheck(r: PricingResult): PricingResult {
  if (r.marginUSD > 0) return r;
  const warning =
    `precio $${r.suggestedPrice.toFixed(2)} NO cubre coste+fees ` +
    `(margen ${r.marginUSD.toFixed(2)} USD / ${r.margin.toFixed(1)}%) — se vendería a pérdida`;
  console.warn(`      ⚠️  Pricing: ${warning}`);
  return { ...r, clamped: true, warning };
}
