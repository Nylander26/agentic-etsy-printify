import { describe, it, expect, vi } from "vitest";
import {
  preResearchGuard,
  hasMarketplaceSignal,
  qualifyNiche,
  qualifyThresholds,
} from "../src/research/niche-filter.js";
import type { NicheAnalysis, MarketplaceSignals } from "../src/research/types.js";

const { minDemandScore, minVisibilityScore } = qualifyThresholds();

/** Minimal NicheAnalysis stub — only the fields the qualification gate reads. */
function analysis(over: Partial<NicheAnalysis>): NicheAnalysis {
  return {
    demandScore: minDemandScore,
    pinterestAvailable: false,
    pinterestScore: 0,
    ...over,
  } as NicheAnalysis;
}

describe("preResearchGuard (product coherence)", () => {
  it("passes product-agnostic and configured-product keywords", () => {
    // config.generation.products = [tshirt]
    expect(preResearchGuard("funny dad bbq").ok).toBe(true);
    expect(preResearchGuard("funny dad shirt").ok).toBe(true);
  });

  it("rejects a keyword naming a non-configured product", () => {
    const r = preResearchGuard("independence day mug");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("mug");
  });
});

describe("hasMarketplaceSignal", () => {
  // The checkpoint is conditional now: with research.use_apify=false there is never a
  // sample, so rejecting on its absence would empty every run. The original rule below
  // still holds whenever the scraper is switched back on.
  it("stands down while apify is off — absence of a scrape we skipped proves nothing", () => {
    expect(hasMarketplaceSignal({ source: "none", listingCount: null } as MarketplaceSignals)).toBe(true);
  });

  it("rejects an empty sample once apify is switched back on", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/apify.js", () => ({ apifyEnabled: () => true, APIFY_OFF_LABEL: "" }));
    const { hasMarketplaceSignal: gated } = await import("../src/research/niche-filter.js");

    expect(gated({ source: "none", listingCount: null } as MarketplaceSignals)).toBe(false);
    expect(gated({ source: "apify", listingCount: null } as MarketplaceSignals)).toBe(true);

    vi.doUnmock("../src/lib/apify.js");
    vi.resetModules();
  });

  it("true when there is an apify sample", () => {
    expect(hasMarketplaceSignal({ source: "apify", listingCount: null } as MarketplaceSignals)).toBe(true);
  });
});

describe("qualifyNiche", () => {
  it("rejects when demand is below the threshold", () => {
    const r = qualifyNiche(analysis({ demandScore: minDemandScore - 1 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("demand");
  });

  it("accepts when demand meets the threshold and Pinterest data is absent", () => {
    expect(qualifyNiche(analysis({ demandScore: minDemandScore })).ok).toBe(true);
  });

  it("does NOT gate on visibility when Pinterest data is unavailable", () => {
    const r = qualifyNiche(
      analysis({ demandScore: minDemandScore, pinterestAvailable: false, pinterestScore: 0 })
    );
    expect(r.ok).toBe(true);
  });

  it("gates on visibility only when Pinterest data exists", () => {
    const r = qualifyNiche(
      analysis({
        demandScore: minDemandScore,
        pinterestAvailable: true,
        pinterestScore: minVisibilityScore - 1,
      })
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("visibilidad");
  });

  it("accepts when both demand and visibility clear their thresholds", () => {
    expect(
      qualifyNiche(
        analysis({
          demandScore: minDemandScore,
          pinterestAvailable: true,
          pinterestScore: minVisibilityScore,
        })
      ).ok
    ).toBe(true);
  });
});
