/**
 * Shared filesystem helpers for design state transitions.
 *
 * Before this module, four agents (validator, reviewer, publisher, pipeline)
 * each carried their own near-identical directory walker and ad-hoc metadata
 * writes. They are unified here so the state machine has a single source of
 * truth for: finding designs by status, moving a design between top-level
 * lifecycle dirs (`approved/`, `rejected/`), and rewriting metadata in place.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync } from "fs";
import { join, dirname, basename } from "path";
import type { DesignMetadata } from "../generator/types.js";

export interface FoundDesign {
  meta: DesignMetadata;
  metaPath: string;
}

/**
 * Recursively scans `root` for `metadata.json` files and returns the designs
 * whose metadata satisfies `filter`. Malformed JSON and non-directories are
 * skipped silently (matches prior per-agent behavior).
 */
export function walkDesigns(
  root: string,
  filter: (meta: DesignMetadata) => boolean
): FoundDesign[] {
  const results: FoundDesign[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === "metadata.json") {
        try {
          const meta = JSON.parse(readFileSync(full, "utf-8")) as DesignMetadata;
          if (filter(meta)) results.push({ meta, metaPath: full });
        } catch {
          // skip malformed
        }
      } else {
        try {
          if (readdirSync(full)) walk(full);
        } catch {
          // not a directory
        }
      }
    }
  }

  walk(root);
  return results;
}

/** Overwrites a design's metadata.json in its current directory. */
export function writeMeta(meta: DesignMetadata): string {
  const metaPath = join(dirname(meta.files.original), "metadata.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return metaPath;
}

/**
 * Moves a design's whole folder from `output/.../<id>` to a top-level
 * lifecycle dir (`approved/<id>` or `rejected/<id>`), rewrites the file paths
 * in its metadata to the new location, sets the terminal status, and persists
 * metadata.json. Returns the updated metadata.
 */
export function moveDesign(
  meta: DesignMetadata,
  dest: "approved" | "rejected"
): DesignMetadata {
  const srcDir = dirname(meta.files.original);
  const destDir = join(dest, meta.id);

  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  rmSync(srcDir, { recursive: true, force: true });

  const updatedFiles: DesignMetadata["files"] = {
    original: join(destDir, basename(meta.files.original)),
    ...(meta.files.noBg ? { noBg: join(destDir, basename(meta.files.noBg)) } : {}),
  };

  const updatedMeta: DesignMetadata = {
    ...meta,
    status: dest === "approved" ? "approved" : "rejected",
    files: updatedFiles,
  };

  writeFileSync(join(destDir, "metadata.json"), JSON.stringify(updatedMeta, null, 2));
  return updatedMeta;
}
