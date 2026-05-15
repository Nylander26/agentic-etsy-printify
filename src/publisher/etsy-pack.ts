import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

export interface EtsyPackEntry {
  designId: string;
  niche: string;
  product: "tshirt" | "mug" | "poster";
  printifyProductId: string;
  title: string;
  description: string;
  tags: string[];
  suggestedPrice: number;
}

export interface EtsyPack {
  generatedAt: string;
  batchId: string;
  count: number;
  instructions: string;
  entries: EtsyPackEntry[];
}

const INSTRUCTIONS = [
  "Cómo usar este pack:",
  "1) Entra a Printify → Products → busca el printifyProductId.",
  "2) Pulsa 'Publish' → selecciona tu tienda de Etsy vinculada.",
  "3) Después en Etsy edita el listing y pega:",
  "     - title (≤140 chars)",
  "     - description (2000+ chars)",
  "     - tags (13 etiquetas, ≤20 chars cada)",
  "4) Marca como 'Made by another company or person' si Etsy lo pide (POD).",
].join("\n");

function todayDir(): string {
  const date = new Date().toISOString().split("T")[0] as string;
  const dir = join("data", "etsy-packs", date);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function nextBatchId(dir: string): string {
  const existing = (() => {
    try { return readdirSync(dir); } catch { return []; }
  })()
    .filter((f) => /^batch-(\d+)\.json$/.test(f))
    .map((f) => parseInt(f.match(/^batch-(\d+)\.json$/)![1]!, 10))
    .filter((n) => !Number.isNaN(n));
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return `batch-${String(next).padStart(3, "0")}`;
}

export function writeEtsyPack(entries: EtsyPackEntry[]): string {
  const dir = todayDir();
  const batchId = nextBatchId(dir);

  const pack: EtsyPack = {
    generatedAt: new Date().toISOString(),
    batchId,
    count: entries.length,
    instructions: INSTRUCTIONS,
    entries,
  };

  const jsonPath = join(dir, `${batchId}.json`);
  writeFileSync(jsonPath, JSON.stringify(pack, null, 2));

  // Also write a copy-paste friendly markdown
  const mdPath = join(dir, `${batchId}.md`);
  const md = [
    `# Etsy pack — ${batchId} (${pack.generatedAt})`,
    "",
    INSTRUCTIONS,
    "",
    ...entries.flatMap((e) => [
      `## ${e.designId} — ${e.niche} (${e.product})`,
      `**Printify product ID:** \`${e.printifyProductId}\``,
      `**Suggested price:** $${e.suggestedPrice.toFixed(2)}`,
      "",
      "### Title",
      e.title,
      "",
      "### Description",
      e.description,
      "",
      "### Tags",
      e.tags.join(", "),
      "",
      "---",
      "",
    ]),
  ].join("\n");
  writeFileSync(mdPath, md);

  return jsonPath;
}
