/**
 * Asset retention. Generated images under output/ are regenerable intermediates — once a
 * design is drafted, its artwork lives on Printify, so old local copies are dead weight
 * (they reached ~1GB). This prunes by "run" (= date):
 *   - output/<YYYY-MM-DD>/  → keep the newest `keepRuns` date folders, delete older ones.
 *   - output/_archive*      → always removed (throwaway folders from manual cleanups).
 *   - approved|rejected|pending-review/<id>/ → keep designs from the newest `keepRuns`
 *     distinct createdAt dates, delete older (kept as a small "just in case" buffer).
 * Never touches output/.draft-index.json (the publish dedup registry).
 */
import { readdirSync, statSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DesignMetadata } from "../generator/types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_DIRS = ["approved", "rejected", "pending-review"] as const;

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Newest `keep` items from a list of date strings (desc), as a Set. */
function keepNewest(dates: string[], keep: number): Set<string> {
  return new Set([...new Set(dates)].sort((a, b) => (a < b ? 1 : -1)).slice(0, keep));
}

export interface CleanupResult { removed: string[]; keptRuns: number; }

export function cleanupAssets(keepRuns: number, dryRun = false): CleanupResult {
  const removed: string[] = [];
  const rm = (p: string) => {
    removed.push(p);
    if (!dryRun) rmSync(p, { recursive: true, force: true });
  };

  // 1. output/ date folders + throwaway archives
  if (isDir("output")) {
    const entries = readdirSync("output");
    const dateDirs = entries.filter((e) => DATE_RE.test(e) && isDir(join("output", e)));
    const keep = keepNewest(dateDirs, keepRuns);
    for (const e of entries) {
      const full = join("output", e);
      if (!isDir(full)) continue;                       // skip .draft-index.json etc.
      if (e.startsWith("_archive")) { rm(full); continue; }
      if (DATE_RE.test(e) && !keep.has(e)) rm(full);
    }
  }

  // 2. status dirs by createdAt date
  const allDates: string[] = [];
  const designDirs: Array<{ dir: string; date: string }> = [];
  for (const root of STATUS_DIRS) {
    if (!isDir(root)) continue;
    for (const id of readdirSync(root)) {
      const dir = join(root, id);
      const metaPath = join(dir, "metadata.json");
      if (!isDir(dir) || !existsSync(metaPath)) continue;
      let date = "";
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as DesignMetadata;
        date = (meta.createdAt ?? "").slice(0, 10);
      } catch { /* unreadable → treat as undated, keep */ }
      if (DATE_RE.test(date)) { allDates.push(date); designDirs.push({ dir, date }); }
    }
  }
  const keepDates = keepNewest(allDates, keepRuns);
  for (const { dir, date } of designDirs) {
    if (!keepDates.has(date)) rm(dir);
  }

  return { removed, keptRuns: keepRuns };
}
