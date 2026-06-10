/**
 * Per-run budget guard.
 *
 * Tracks estimated spend across the paid operations of a single process/run
 * (Gemini images / text / vision + Apify scraper calls) and aborts BEFORE a call
 * that would push the run over a configurable ceiling. Until now the only brake
 * was the manual confirmation gate in the pipeline ([1.5/6]); this is the automatic
 * one (R3).
 *
 * Scope = one process: each `pnpm pipeline` / `pnpm generate` / `pnpm research`
 * invocation is one run, so the singleton naturally resets between runs — no
 * persistence needed.
 *
 * Charging contract: `charge()` is called immediately BEFORE the paid call. If the
 * new total would exceed the cap it throws `BudgetExceededError` and nothing is
 * spent; otherwise it commits the cost and returns the running total.
 */
import { getConfig } from "./config.js";

export type SpendCategory = "image" | "text" | "vision" | "apify";

export class BudgetExceededError extends Error {
  constructor(
    public readonly category: SpendCategory,
    public readonly attempted: number,
    public readonly cap: number,
    public readonly spent: number
  ) {
    super(
      `Techo de presupuesto alcanzado: ${category} llevaría el gasto a ` +
        `$${attempted.toFixed(2)} > tope $${cap.toFixed(2)} (ya gastado $${spent.toFixed(2)})`
    );
    this.name = "BudgetExceededError";
  }
}

interface BudgetState {
  enabled: boolean;
  cap: number;
  unit: Record<SpendCategory, number>;
  spent: number;
  counts: Record<SpendCategory, number>;
}

let _state: BudgetState | null = null;

function state(): BudgetState {
  if (!_state) {
    const b = getConfig().budget;
    _state = {
      enabled: b.enabled,
      cap: b.max_usd_per_run,
      unit: {
        image: b.cost_per_image_usd,
        text: b.cost_per_text_usd,
        vision: b.cost_per_vision_usd,
        apify: b.cost_per_apify_call_usd,
      },
      spent: 0,
      counts: { image: 0, text: 0, vision: 0, apify: 0 },
    };
  }
  return _state;
}

/**
 * Records a spend of `count` units in `category`. Throws BudgetExceededError
 * (committing nothing) if it would exceed the run cap. Returns new total spent.
 * A cap of 0 (or enabled=false) means "track only, never abort".
 */
export function charge(category: SpendCategory, count = 1): number {
  const s = state();
  const cost = s.unit[category] * count;
  if (s.enabled && s.cap > 0 && s.spent + cost > s.cap) {
    throw new BudgetExceededError(category, s.spent + cost, s.cap, s.spent);
  }
  s.spent += cost;
  s.counts[category] += count;
  return s.spent;
}

/** Cost of `count` units of `category` without committing it. */
export function estimateCost(category: SpendCategory, count: number): number {
  return state().unit[category] * count;
}

/** Remaining headroom before the cap (>= 0). */
export function remainingUsd(): number {
  const s = state();
  return s.cap > 0 ? Math.max(0, s.cap - s.spent) : Infinity;
}

export function budgetEnabled(): boolean {
  return state().enabled && state().cap > 0;
}

/** One-line spend report for run summaries. */
export function budgetReport(): string {
  const s = state();
  if (!s.enabled) return "💰 Presupuesto: deshabilitado";
  const cap = s.cap > 0 ? `$${s.cap.toFixed(2)}` : "sin tope";
  const parts = `img=${s.counts.image} · vision=${s.counts.vision} · texto=${s.counts.text} · apify=${s.counts.apify}`;
  return `💰 Gasto del run: $${s.spent.toFixed(2)} / ${cap} (${parts})`;
}
