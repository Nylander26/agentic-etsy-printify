/**
 * Shared niche qualification — the SINGLE source of truth used by BOTH the
 * pipeline (`pipeline.ts`) and the standalone research CLI (`research/index.ts`).
 *
 * Neither flow may define its own niche-acceptance rules. If a rule changes,
 * it changes here once and both flows inherit it.
 *
 * Three checkpoints, in order of cost:
 *   1. preResearchGuard   — product coherence (free; runs before any API spend)
 *   2. hasMarketplaceSignal — niche has Etsy presence worth analyzing
 *   3. qualifyNiche       — demand + visibility gates (after Gemini analysis)
 */
import { coherenceRejectReason } from "./product-coherence.js";
import { env } from "../lib/env.js";
import { getConfig } from "../lib/config.js";
import type { NicheAnalysis, MarketplaceSignals, PinterestSignals } from "./types.js";
import type { ProductType } from "../generator/types.js";

export interface QualifyResult {
  ok: boolean;
  reason?: string;
}

/** Resolve the qualification thresholds from config (one place). */
export function qualifyThresholds() {
  const r = getConfig().research;
  return {
    minDemandScore: r.min_demand_score,
    minVisibilityScore: r.min_visibility_score,
  };
}

/**
 * Checkpoint 1 — product coherence. Cheap guard before spending any Apify/Gemini
 * call: reject keywords that name a product we don't produce ("Independence Day Mug"
 * when products=[tshirt]).
 */
export function preResearchGuard(keyword: string): QualifyResult {
  const products = getConfig().generation.products as ProductType[];
  const incoherent = coherenceRejectReason(keyword, products);
  return incoherent ? { ok: false, reason: incoherent } : { ok: true };
}

/** Checkpoint 2 — does this niche have any marketplace signal worth analyzing? */
export function hasMarketplaceSignal(m: MarketplaceSignals): boolean {
  return !(m.source === "none" && m.listingCount === null);
}

/**
 * Checkpoint 3 — qualification gates after Gemini analysis.
 *   - demandScore >= minDemandScore (always enforced)
 *   - pinterestScore >= minVisibilityScore (ONLY when Pinterest data exists;
 *     if the actor failed or no token, visibility does not block — fallback)
 */
export function qualifyNiche(n: NicheAnalysis): QualifyResult {
  const { minDemandScore, minVisibilityScore } = qualifyThresholds();

  if (n.demandScore < minDemandScore) {
    return { ok: false, reason: `demand ${n.demandScore} < ${minDemandScore}` };
  }

  if (n.pinterestAvailable && n.pinterestScore < minVisibilityScore) {
    return {
      ok: false,
      reason: `visibilidad ${n.pinterestScore.toFixed(1)} < ${minVisibilityScore} (Pinterest)`,
    };
  }

  return { ok: true };
}

/** Shared Pinterest status label so both flows print identical wording. */
export function pinterestStatusLabel(p: PinterestSignals): string {
  if (p.source === "apify") {
    return `trend=${p.trendScore}/10 promoted=${((p.promotedRatio ?? 0) * 100).toFixed(0)}%`;
  }
  return env.APIFY_TOKEN ? "sin señal (actor falló) — pinterest=0" : "skip (no token)";
}
