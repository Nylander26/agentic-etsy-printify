/**
 * Central, run-independent registry of drafts already created in Printify.
 *
 * The per-design `metadata.json` `drafts[]` array only protects against re-drafting a
 * design whose metadata file we happen to re-read. It does NOT survive copies of the
 * design folder, regenerated metadata, or running publish across different `approved/`
 * snapshots — which is how ~149 products ended up with many duplicates.
 *
 * This index is a single JSON file keyed by a stable `designId::product` identity. It is
 * the authoritative "have we drafted this?" check, consulted before every createProduct.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { ProductType } from "../generator/types.js";

const INDEX_PATH = "output/.draft-index.json";

export interface DraftIndexEntry {
  designId: string;
  product: ProductType;
  printifyProductId: string;
  title: string;
  draftedAt: string;
}

type IndexShape = Record<string, DraftIndexEntry>; // key = `${designId}::${product}`

const keyOf = (designId: string, product: ProductType) => `${designId}::${product}`;

let _cache: IndexShape | null = null;

function load(): IndexShape {
  if (_cache) return _cache;
  if (!existsSync(INDEX_PATH)) {
    _cache = {};
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as IndexShape;
  } catch {
    _cache = {};
  }
  return _cache;
}

function persist(idx: IndexShape): void {
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
}

/** True if this design+product was already drafted in a previous (or current) run. */
export function isDrafted(designId: string, product: ProductType): DraftIndexEntry | undefined {
  return load()[keyOf(designId, product)];
}

/** Records a freshly created draft. Idempotent on the (designId, product) key. */
export function recordDraft(entry: Omit<DraftIndexEntry, "draftedAt">): void {
  const idx = load();
  idx[keyOf(entry.designId, entry.product)] = { ...entry, draftedAt: new Date().toISOString() };
  persist(idx);
}

/** All recorded titles (for secondary cross-design dedup against Printify). */
export function draftedTitles(): Set<string> {
  return new Set(Object.values(load()).map((e) => e.title.trim().toLowerCase()));
}
