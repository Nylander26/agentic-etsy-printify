import Database from "better-sqlite3";
import type { DesignMetadata } from "../generator/types.js";

const DB_PATH = "pipeline.sqlite";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS niches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword     TEXT NOT NULL,
      researched_at TEXT NOT NULL,
      demand_score  REAL,
      competition_score REAL,
      avg_price   REAL,
      score       REAL,
      raw_json    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS designs (
      id          TEXT PRIMARY KEY,
      niche       TEXT NOT NULL,
      concept     TEXT NOT NULL,
      product     TEXT NOT NULL,
      variation   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending-review',
      created_at  TEXT NOT NULL,
      metadata_path TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id                TEXT PRIMARY KEY,
      design_id         TEXT NOT NULL REFERENCES designs(id),
      printify_id       TEXT,
      etsy_listing_id   TEXT,
      title             TEXT,
      price             REAL,
      published_at      TEXT,
      FOREIGN KEY (design_id) REFERENCES designs(id)
    );

    CREATE TABLE IF NOT EXISTS stats (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      etsy_listing_id TEXT NOT NULL,
      checked_at  TEXT NOT NULL,
      views       INTEGER DEFAULT 0,
      favorers    INTEGER DEFAULT 0,
      sales       INTEGER DEFAULT 0,
      revenue     REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      phase       TEXT NOT NULL,
      seeds       TEXT,
      niches_found  INTEGER DEFAULT 0,
      designs_generated INTEGER DEFAULT 0,
      designs_published INTEGER DEFAULT 0,
      error       TEXT
    );
  `);

  return _db;
}

// ── Niches ────────────────────────────────────────────────────────────────────

export function wasNicheResearchedRecently(
  keyword: string,
  withinDays = 7
): boolean {
  const db = getDb();
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const row = db
    .prepare(
      "SELECT id FROM niches WHERE keyword = ? AND researched_at > ? LIMIT 1"
    )
    .get(keyword, cutoff);
  return row !== undefined;
}

export function saveNicheAnalysis(
  keyword: string,
  analysis: {
    demandScore: number;
    competitionScore: number;
    avgPrice: number;
    score: number;
  },
  rawJson: object
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO niches (keyword, researched_at, demand_score, competition_score, avg_price, score, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    keyword,
    new Date().toISOString(),
    analysis.demandScore,
    analysis.competitionScore,
    analysis.avgPrice,
    analysis.score,
    JSON.stringify(rawJson)
  );
}

// ── Designs ───────────────────────────────────────────────────────────────────

export function wasDesignGeneratedRecently(
  niche: string,
  concept: string,
  product: string,
  withinDays = 14
): boolean {
  const db = getDb();
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const row = db
    .prepare(
      `SELECT id FROM designs
       WHERE niche = ? AND concept = ? AND product = ? AND created_at > ?
       LIMIT 1`
    )
    .get(niche, concept, product, cutoff);
  return row !== undefined;
}

export function saveDesign(meta: DesignMetadata, metadataPath: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO designs (id, niche, concept, product, variation, status, created_at, metadata_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    meta.id,
    meta.niche,
    meta.concept,
    meta.product,
    meta.variation,
    meta.status,
    meta.createdAt,
    metadataPath
  );
}

export function updateDesignStatus(
  designId: string,
  status: DesignMetadata["status"]
): void {
  getDb()
    .prepare("UPDATE designs SET status = ? WHERE id = ?")
    .run(status, designId);
}

// ── Products ──────────────────────────────────────────────────────────────────

export function savePublishedProduct(
  designId: string,
  printifyId: string,
  title: string,
  price: number
): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO products (id, design_id, printify_id, title, price, published_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `${designId}-product`,
    designId,
    printifyId,
    title,
    price,
    new Date().toISOString()
  );
}

// ── Pipeline runs ─────────────────────────────────────────────────────────────

export function startPipelineRun(phase: string, seeds: string[]): number {
  const result = getDb().prepare(`
    INSERT INTO pipeline_runs (started_at, phase, seeds)
    VALUES (?, ?, ?)
  `).run(new Date().toISOString(), phase, seeds.join(","));
  return result.lastInsertRowid as number;
}

export function finishPipelineRun(
  runId: number,
  stats: { nichesFound?: number; designsGenerated?: number; designsPublished?: number; error?: string }
): void {
  getDb().prepare(`
    UPDATE pipeline_runs
    SET finished_at = ?, niches_found = ?, designs_generated = ?, designs_published = ?, error = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    stats.nichesFound ?? 0,
    stats.designsGenerated ?? 0,
    stats.designsPublished ?? 0,
    stats.error ?? null,
    runId
  );
}
