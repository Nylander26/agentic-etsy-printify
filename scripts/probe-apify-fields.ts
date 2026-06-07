/**
 * Sondeo único: imprime los campos crudos que devuelve un actor de Etsy en Apify
 * para una keyword. Objetivo: ver qué señal de VENTAS / RESEÑAS expone.
 *
 *   pnpm tsx scripts/probe-apify-fields.ts <keyword> [actorId]
 *   pnpm tsx scripts/probe-apify-fields.ts "funny dad shirt" khadinakbar~etsy-all-in-one-scraper
 */
import axios from "axios";
import "dotenv/config";

const BASE = "https://api.apify.com/v2";
const TOKEN = process.env.APIFY_TOKEN;

async function main() {
  const keyword = process.argv[2] || "funny dad shirt";
  const actor = process.argv[3] || process.env.APIFY_ETSY_ACTOR_ID || "automation-lab~etsy-scraper";
  if (!TOKEN) { console.error("APIFY_TOKEN no seteado"); process.exit(1); }

  console.log(`Actor: ${actor}\nKeyword: "${keyword}"\nmaxItems: 5 (sondeo barato)\n`);

  // Esquema mixto: cubre automation-lab (searchQuery/maxItems) y khadinakbar (searchQueries/maxResults).
  const body: Record<string, unknown> = {
    searchQuery: keyword,
    searchQueries: [keyword],
    maxItems: 5,
    maxResults: 5,
    sortOrder: "most_relevant",
    includeProductDetails: true, // necesario en khadinakbar para review_count / shop_sales_count
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "US" },
  };

  const res = await axios.post(
    `${BASE}/acts/${actor}/run-sync-get-dataset-items`,
    body,
    { params: { token: TOKEN }, timeout: 300_000, validateStatus: (s) => s < 500 }
  );

  const items = Array.isArray(res.data) ? res.data : [];
  console.log(`HTTP ${res.status} — ${items.length} items\n`);
  if (!items.length) { console.log(JSON.stringify(res.data, null, 2).slice(0, 800)); return; }

  console.log("CAMPOS del primer item:");
  console.log(Object.keys(items[0]).join(", "));
  console.log("\nPrimer item completo:");
  console.log(JSON.stringify(items[0], null, 2));

  // Resaltar señales de ventas si aparecen
  const salesKeys = ["review_count", "reviewCount", "numReviews", "num_favorers", "shop_sales_count",
    "shopSalesCount", "sold_count", "soldCount", "sales", "badge_bestseller", "isBestseller", "bestseller"];
  const found = salesKeys.filter((k) => k in items[0]);
  console.log(`\nSeñales de ventas presentes: ${found.length ? found.join(", ") : "NINGUNA"}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
