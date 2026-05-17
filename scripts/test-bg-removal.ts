/**
 * Smoke test: apply removeBackground to an image and write the result next to it.
 * Usage: pnpm tsx scripts/test-bg-removal.ts <path-to-png>
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { removeBackground } from "../src/generator/post-processor.js";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: pnpm tsx scripts/test-bg-removal.ts <path-to-png>");
    process.exit(1);
  }

  const buf = readFileSync(input);
  console.log(`Input:  ${input} (${(buf.length / 1024).toFixed(1)} KB)`);

  const t0 = Date.now();
  const out = await removeBackground(buf);
  const ms = Date.now() - t0;

  const outPath = join(dirname(input), `${basename(input, ".png")}-nobg.png`);
  writeFileSync(outPath, out);
  console.log(`Output: ${outPath} (${(out.length / 1024).toFixed(1)} KB) in ${ms}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
