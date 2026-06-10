/**
 * Run-independent registry of perceptual hashes of generated designs.
 *
 * Before generating spends the validator API call (and risks a duplicate Etsy
 * listing), the generator computes a design's dHash and asks this index whether
 * a visually-equivalent design already exists in the last few runs. It's a single
 * JSON file (like draft-index.ts) so it survives across runs and processes.
 *
 * Pruned to the newest `compareRuns` distinct run-dates on every write: entries
 * outside the comparison window are never consulted, so keeping them is dead weight.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { hammingDistance } from "./phash.js";

const INDEX_PATH = "output/.phash-index.json";

export interface PhashEntry {
  hash: string;       // 16-char hex dHash
  designId: string;
  date: string;       // YYYY-MM-DD run date
}

let _cache: PhashEntry[] | null = null;

function load(): PhashEntry[] {
  if (_cache) return _cache;
  if (!existsSync(INDEX_PATH)) {
    _cache = [];
    return _cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
    _cache = Array.isArray(parsed) ? (parsed as PhashEntry[]) : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

/** Keeps only entries from the newest `compareRuns` distinct dates. */
function prune(entries: PhashEntry[], compareRuns: number): PhashEntry[] {
  const keep = new Set(
    [...new Set(entries.map((e) => e.date))].sort((a, b) => (a < b ? 1 : -1)).slice(0, compareRuns)
  );
  return entries.filter((e) => keep.has(e.date));
}

function persist(entries: PhashEntry[]): void {
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
}

/**
 * Returns the first recorded entry within `maxDistance` Hamming distance of `hash`
 * (i.e. a near-duplicate), or undefined. Only entries from the newest `compareRuns`
 * distinct dates are considered.
 */
export function findSimilar(
  hash: string,
  maxDistance: number,
  compareRuns: number
): (PhashEntry & { distance: number }) | undefined {
  const candidates = prune(load(), compareRuns);
  for (const e of candidates) {
    const distance = hammingDistance(hash, e.hash);
    if (distance <= maxDistance) return { ...e, distance };
  }
  return undefined;
}

/** Records a design's hash and prunes to the comparison window. Idempotent on hash+designId. */
export function recordHash(entry: PhashEntry, compareRuns: number): void {
  const entries = load();
  if (!entries.some((e) => e.hash === entry.hash && e.designId === entry.designId)) {
    entries.push(entry);
  }
  _cache = prune(entries, compareRuns);
  persist(_cache);
}
