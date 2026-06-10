import { describe, it, expect } from "vitest";
import { charge, estimateCost, budgetEnabled, BudgetExceededError } from "../src/lib/budget.js";
import { getConfig } from "../src/lib/config.js";

const b = getConfig().budget;

describe("estimateCost (pure)", () => {
  it("multiplies unit cost by count without mutating spend", () => {
    expect(estimateCost("image", 10)).toBeCloseTo(b.cost_per_image_usd * 10, 6);
    expect(estimateCost("apify", 3)).toBeCloseTo(b.cost_per_apify_call_usd * 3, 6);
    // Calling estimate twice must not change anything.
    expect(estimateCost("image", 10)).toBeCloseTo(b.cost_per_image_usd * 10, 6);
  });
});

describe("charge — per-run ceiling", () => {
  it("accumulates spend and throws BudgetExceededError before exceeding the cap", () => {
    if (!budgetEnabled()) {
      // cap=0 or disabled → never aborts; tracking only.
      expect(charge("image")).toBeGreaterThanOrEqual(0);
      return;
    }

    const cap = b.max_usd_per_run;
    const unit = b.cost_per_image_usd;

    // Spend up to one unit below the cap in a single call (avoids float-boundary flakiness).
    const under = Math.max(1, Math.floor(cap / unit) - 1);
    const spent = charge("image", under);
    expect(spent).toBeLessThan(cap);

    // A charge that clearly exceeds the remaining headroom must throw AND commit nothing.
    expect(() => charge("image", Math.ceil(cap / unit) + 5)).toThrow(BudgetExceededError);

    // Because the rejected charge committed nothing, a charge within the leftover
    // headroom still succeeds and increases the running total.
    const after = charge("image", 1);
    expect(after).toBeGreaterThan(spent);
    expect(after).toBeLessThanOrEqual(cap + 1e-9);
  });
});
