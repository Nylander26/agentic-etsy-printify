/**
 * Sales → discovery feedback bridge.
 *
 * The monitor (`pnpm stats`) reads real Printify orders — the only programmatic
 * demand signal in the stack — but until now that data died in the dashboard.
 * This persists a compact, decoupled artifact that the next discovery run reads
 * to bias niche proposals toward what actually sells (R2 in TODO).
 *
 * Decoupling: monitor writes, discovery reads, neither imports the other. The
 * artifact lives next to research output so it's easy to inspect / delete.
 *
 * Gated by design: with zero sales (e.g. store still in dev mode) `hasSignal`
 * is false and discovery behaves exactly as before — no behavior change until
 * real orders exist.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { PodCategory } from "../research/calendar.js";

const FEEDBACK_PATH = "research-results/sales-feedback.json";

export interface WinnerNiche {
  niche: string;
  units: number;
  revenue: number;
  category: PodCategory | null;
}

export interface SalesFeedback {
  generatedAt: string;
  totalUnits: number;
  /** Niches with real sales, sorted by units desc. */
  winners: WinnerNiche[];
  /** Units sold per inferred POD category (only categories with sales). */
  categoryUnits: Partial<Record<PodCategory, number>>;
}

export function writeSalesFeedback(fb: SalesFeedback): string {
  mkdirSync(dirname(FEEDBACK_PATH), { recursive: true });
  writeFileSync(FEEDBACK_PATH, JSON.stringify(fb, null, 2));
  return FEEDBACK_PATH;
}

export function readSalesFeedback(): SalesFeedback | null {
  if (!existsSync(FEEDBACK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FEEDBACK_PATH, "utf-8")) as SalesFeedback;
  } catch {
    return null;
  }
}

/** True when there's real sales data worth biasing discovery on. */
export function hasSignal(fb: SalesFeedback | null): fb is SalesFeedback {
  return !!fb && fb.totalUnits > 0 && fb.winners.length > 0;
}
