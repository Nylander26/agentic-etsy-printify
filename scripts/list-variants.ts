/**
 * Lists all variants for a Printify blueprint + provider, grouped by color.
 * Usage: pnpm tsx scripts/list-variants.ts <blueprintId> <printProviderId>
 * Example: pnpm tsx scripts/list-variants.ts 5 29   # Bella+Canvas 3001 / Monster Digital
 */
import { getCatalogVariants } from "../src/lib/printify.js";

async function main() {
  const blueprintId = Number(process.argv[2]);
  const providerId = Number(process.argv[3]);

  if (!blueprintId || !providerId) {
    console.error("Usage: pnpm tsx scripts/list-variants.ts <blueprintId> <printProviderId>");
    process.exit(1);
  }

  const variants = await getCatalogVariants(blueprintId, providerId);
  console.log(`\nBlueprint ${blueprintId} / Provider ${providerId} — ${variants.length} variants\n`);

  // Group by color (if options.color exists), else by full title
  const groups = new Map<string, Array<{ id: number; size: string; title: string }>>();

  for (const v of variants) {
    const color = v.options?.color ?? "(no-color)";
    const size = v.options?.size ?? "";
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color)!.push({ id: v.id, size, title: v.title });
  }

  // Sort colors alphabetically, sizes in standard order
  const sizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const sizeIdx = (s: string) => {
    const i = sizeOrder.indexOf(s.toUpperCase());
    return i === -1 ? 999 : i;
  };

  for (const color of [...groups.keys()].sort()) {
    const list = groups.get(color)!.sort((a, b) => sizeIdx(a.size) - sizeIdx(b.size));
    console.log(`▸ ${color}`);
    for (const v of list) {
      console.log(`    ${String(v.id).padEnd(8)} ${v.size || v.title}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
