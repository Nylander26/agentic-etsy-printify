import { describe, it, expect } from "vitest";
import { hasSignal, type SalesFeedback } from "../src/lib/sales-feedback.js";

function fb(over: Partial<SalesFeedback>): SalesFeedback {
  return {
    generatedAt: "2026-06-10T00:00:00.000Z",
    totalUnits: 0,
    winners: [],
    categoryUnits: {},
    ...over,
  };
}

describe("hasSignal (R2 discovery gate)", () => {
  it("is false for null / no sales", () => {
    expect(hasSignal(null)).toBe(false);
    expect(hasSignal(fb({ totalUnits: 0, winners: [] }))).toBe(false);
  });

  it("is false when units exist but there are no winner niches", () => {
    expect(hasSignal(fb({ totalUnits: 5, winners: [] }))).toBe(false);
  });

  it("is true only with real sales AND at least one winner", () => {
    const signal = fb({
      totalUnits: 4,
      winners: [{ niche: "funny cat mom", units: 4, revenue: 100, category: "humor" }],
      categoryUnits: { humor: 4 },
    });
    expect(hasSignal(signal)).toBe(true);
  });
});
