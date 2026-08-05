import { describe, it, expect, vi, afterEach } from "vitest";
import { calculatePrice } from "../src/publisher/pricing.js";

afterEach(() => vi.restoreAllMocks());

describe("calculatePrice — live config shape", () => {
  const LIVE = {
    targetNetMargin: 0.14,
    freeShipping: true,
    shippingCost: 4.29, // free Economy, what the store actually offers
    offsiteAdsRate: 0.15, // the rate below $10k/yr — it DROPS to 12% above, not up
  };

  it("lands on $29.99 for the configured targets", () => {
    const r = calculatePrice("tshirt", LIVE);
    expect(r.suggestedPrice).toBe(29.99);
    expect(r.marginUSD).toBeGreaterThan(0);
    expect(r.clamped).toBeUndefined();
  });

  // Reconciles our formula against an external source of truth: the profit Printify's own
  // dashboard reports for the size-L row at $29.99 (production $14.09). If a fee constant
  // here ever drifts from what Etsy actually charges, this is what catches it.
  it("reproduces the profit Printify reports for the size-L row, to the cent", () => {
    const r = calculatePrice("tshirt", { ...LIVE, forcePrice: 29.99, baseCostOverride: 14.09 });
    expect(r.marginUSD).toBeCloseTo(3.81, 2);
    expect(r.margin).toBeCloseTo(12.7, 1);
  });

  it("earns more on the cheapest size, as Printify's range shows", () => {
    const r = calculatePrice("tshirt", { ...LIVE, forcePrice: 29.99, baseCostOverride: 11.43 });
    expect(r.marginUSD).toBeCloseTo(6.47, 2);
  });

  it("rounds up to a price point, never down below the solved price", () => {
    const r = calculatePrice("tshirt", { targetNetMargin: 0.05, offsiteAdsRate: 0 });
    const raw = (13.5 + 4.29 + 0.45) / (1 - 0.095 - 0.05);
    expect(r.suggestedPrice).toBeGreaterThanOrEqual(raw);
  });

  it("would price above the POD market if we still asked for 16% net", () => {
    // Why target_net_margin dropped to 0.14: same costs, 16% target, and the solved price
    // jumps a whole price point past what this market bears.
    const r = calculatePrice("tshirt", { ...LIVE, targetNetMargin: 0.16 });
    expect(r.suggestedPrice).toBe(34.99);
  });
});

describe("calculatePrice — the silent failures", () => {
  // Both of these used to come back looking like ordinary prices with nothing said.
  it("flags a target the price ladder cannot reach", () => {
    const r = calculatePrice("tshirt", { targetNetMargin: 0.7, offsiteAdsRate: 0.12 });
    expect(r.clamped).toBe(true);
    expect(r.warning).toMatch(/supera el tope/);
  });

  it("flags a forced price that sells at a loss", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = calculatePrice("tshirt", { forcePrice: 9.99 });

    expect(r.marginUSD).toBeLessThan(0);
    expect(r.clamped).toBe(true);
    expect(r.warning).toMatch(/pérdida/);
    expect(warn).toHaveBeenCalled();
  });

  it("stays silent when the price is healthy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = calculatePrice("tshirt", { forcePrice: 29.99, offsiteAdsRate: 0.12 });

    expect(r.warning).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats break-even as not solvent — zero profit is not a business", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Solve the exact break-even price for these inputs.
    const breakEven = (13.5 + 0.45) / (1 - 0.095);
    const r = calculatePrice("tshirt", { forcePrice: breakEven, freeShipping: false });

    expect(r.marginUSD).toBeCloseTo(0, 6);
    expect(r.clamped).toBe(true);
  });
});
