import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { fetchMarketplaceSignals } from "../src/research/apify-source.js";
import { fetchPinterestSignals } from "../src/research/pinterest-source.js";
import { hasMarketplaceSignal, qualifyNiche } from "../src/research/niche-filter.js";
import { apifyEnabled } from "../src/lib/apify.js";
import { getConfig } from "../src/lib/config.js";
import type { NicheAnalysis, MarketplaceSignals } from "../src/research/types.js";

// The subscription is cancelled. A call that slips through is a real charge, so this
// spies on the transport itself rather than trusting the guard's return value.
let post: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  post = vi.spyOn(axios.Axios.prototype, "post");
});
afterEach(() => vi.restoreAllMocks());

const EMPTY_MARKETPLACE: MarketplaceSignals = {
  source: "none",
  listingCount: null,
  avgPrice: null,
  minPrice: null,
  maxPrice: null,
  estMonthlyRevenue: null,
  estMonthlySales: null,
  avgRating: null,
  topRating: null,
  sampledListings: 0,
  titles: [],
  topTags: [],
};

describe("apify kill switch", () => {
  it("is off in the committed config", () => {
    expect(getConfig().research.use_apify).toBe(false);
    expect(apifyEnabled()).toBe(false);
  });

  it("issues no HTTP request for marketplace signals", async () => {
    const signals = await fetchMarketplaceSignals("funny halloween pregnant announcement shirt");
    expect(post).not.toHaveBeenCalled();
    expect(signals.source).toBe("none");
  });

  it("issues no HTTP request for Pinterest signals", async () => {
    const signals = await fetchPinterestSignals("funny halloween pregnant announcement shirt");
    expect(post).not.toHaveBeenCalled();
    expect(signals.source).not.toBe("apify");
  });
});

describe("gates that used to depend on Apify", () => {
  // Both of these rejected on absent data. With the scrapers off, absent data is the
  // normal state, so leaving them armed would empty every run instead of failing loudly.
  it("does not treat a missing scrape as a niche without marketplace presence", () => {
    expect(hasMarketplaceSignal(EMPTY_MARKETPLACE)).toBe(true);
  });

  it("skips the demand gate when no marketplace sample backs the score", () => {
    const analysis = {
      keyword: "funny halloween pregnant announcement shirt",
      demandScore: 5, // what Gemini returns when told to stay conservative
      competitionScore: 5,
      avgPrice: 24,
      marketplaceSource: "none",
      pinterestScore: 0,
      pinterestAvailable: false,
    } as NicheAnalysis;

    expect(getConfig().research.min_demand_score).toBeGreaterThan(analysis.demandScore);
    expect(qualifyNiche(analysis).ok).toBe(true);
  });

  it("still enforces the demand gate when a real sample exists", () => {
    const analysis = {
      keyword: "teacher halloween shirt",
      demandScore: 3,
      competitionScore: 9,
      avgPrice: 24,
      marketplaceSource: "apify",
      pinterestScore: 0,
      pinterestAvailable: false,
    } as NicheAnalysis;

    const r = qualifyNiche(analysis);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/demand/);
  });
});
