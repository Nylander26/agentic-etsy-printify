/**
 * Sondeo del actor de Pinterest en Apify.
 * Imprime todos los campos crudos del primer item para ver qué señales de
 * engagement expone (saves, repins, likes, etc.) y ajustar pinterest-source.ts.
 *
 *   pnpm tsx scripts/probe-pinterest-actor.ts <keyword> [actorId]
 *   pnpm tsx scripts/probe-pinterest-actor.ts "funny dad shirt"
 *   pnpm tsx scripts/probe-pinterest-actor.ts "funny dad shirt" apify~pinterest-scraper
 */
import axios from "axios";
import "dotenv/config";

const BASE = "https://api.apify.com/v2";
const TOKEN = process.env.APIFY_TOKEN;

async function main() {
  const keyword = process.argv[2] || "funny dad shirt";
  const actor = process.argv[3] || process.env.APIFY_PINTEREST_ACTOR_ID || "apify~pinterest-scraper";
  if (!TOKEN) { console.error("APIFY_TOKEN no seteado"); process.exit(1); }

  const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`;
  console.log(`Actor:      ${actor}`);
  console.log(`Keyword:    "${keyword}"`);
  console.log(`SearchURL:  ${searchUrl}`);
  console.log(`maxResults: 3 (sondeo barato)\n`);

  // automation-lab actors use searchQuery/maxItems (same pattern as their Etsy scraper).
  // Fallback: startUrls for actors that work with Pinterest search URLs directly.
  const body = {
    searchQuery: keyword,
    maxItems: 5,
    maxResults: 5,
    startUrls: [{ url: searchUrl }],
  };

  const res = await axios.post(
    `${BASE}/acts/${actor}/run-sync-get-dataset-items`,
    body,
    { params: { token: TOKEN }, timeout: 300_000, validateStatus: (s) => s < 500 }
  );

  const items = Array.isArray(res.data) ? res.data : [];
  console.log(`HTTP ${res.status} — ${items.length} items\n`);

  if (!items.length) {
    console.log("Sin items. Respuesta cruda:");
    console.log(JSON.stringify(res.data, null, 2).slice(0, 1000));
    return;
  }

  console.log("CAMPOS del primer item:");
  console.log(Object.keys(items[0]).join(", "));
  console.log("\nPrimer item completo:");
  console.log(JSON.stringify(items[0], null, 2));

  if (items.length > 1) {
    console.log("\nSegundo item (campos):");
    console.log(Object.keys(items[1]).join(", "));
  }

  // Resaltar señales de engagement si aparecen
  const engagementKeys = [
    "saves", "repinCount", "repins", "likeCount", "likes",
    "commentCount", "comments", "reactions", "shareCount",
    "closeupUnifiedDescription", "dominantColor", "pinType",
  ];
  const found = engagementKeys.filter((k) => k in (items[0] ?? {}));
  console.log(`\nSeñales de engagement presentes: ${found.length ? found.join(", ") : "NINGUNA"}`);

  if (found.length) {
    console.log("\nValores de engagement en los items:");
    for (const item of items) {
      const vals = found.map((k) => `${k}=${JSON.stringify((item as Record<string, unknown>)[k])}`).join(", ");
      console.log(`  ${vals}`);
    }
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
