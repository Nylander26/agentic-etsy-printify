/**
 * Single kill switch for every paid Apify call in the project.
 *
 * The Apify subscription was cancelled, so both scrapers (Etsy marketplace sample and
 * Pinterest visibility) must never fire. The code they live in is deliberately left
 * untouched and working: this returns false, the sources short-circuit to their EMPTY
 * signal, and nothing downstream sees a different shape than it already handled for a
 * missing token. Setting `research.use_apify: true` restores the old behavior with no
 * other edit.
 *
 * What replaced it: keyword volume and competition are now measured out-of-band through
 * the EverBee MCP before a keyword is written into `research.keywords_seed`, so the
 * pipeline no longer needs to discover that data at runtime.
 */
import { getConfig } from "./config.js";

export function apifyEnabled(): boolean {
  return getConfig().research.use_apify;
}

/** Uniform one-liner so every flow reports the skip identically. */
export const APIFY_OFF_LABEL = "apify off (research.use_apify=false)";
