/**
 * Semana 1 entregable: verifica conexión real a las 3 APIs.
 * Ejecutar: pnpm test:apis
 * Requiere .env con todas las keys configuradas y Etsy autorizado.
 */
import { generateText, generateImage } from "./lib/gemini.js";
import { getMe, getActiveListings } from "./lib/etsy.js";
import { getShops, getBlueprints } from "./lib/printify.js";
import { writeFileSync } from "fs";

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string, err: unknown) { console.error(`  ❌ ${msg}:`, err); }

async function testGeminiText() {
  console.log("\n📝 Gemini Pro (texto)...");
  try {
    const response = await generateText(
      'Respond with exactly: {"status":"ok","model":"gemini-pro"}'
    );
    console.log("  Raw response:", response.slice(0, 100));
    ok("Gemini Pro text OK");
  } catch (err) {
    fail("Gemini Pro text", err);
  }
}

async function testGeminiImage() {
  console.log("\n🎨 Gemini Image (Nano Banana)...");
  try {
    const img = await generateImage(
      "A simple minimalist star shape on white background, suitable for a t-shirt print"
    );
    writeFileSync("test-image.png", Buffer.from(img.base64, "base64"));
    ok(`Image generated — saved to test-image.png (${img.mimeType})`);
  } catch (err) {
    fail("Gemini Image", err);
  }
}

async function testEtsy() {
  console.log("\n🛍️  Etsy API...");
  try {
    const me = await getMe();
    ok(`Authenticated. shop_id=${me.shop_id}, user_id=${me.user_id}`);

    if (me.shop_id) {
      const listings = await getActiveListings(me.shop_id);
      ok(`Active listings: ${listings.length}`);
      if (listings[0]) {
        console.log(`  First listing: "${listings[0].title}" (${listings[0].state})`);
      }
    }
  } catch (err) {
    fail("Etsy API", err);
  }
}

async function testPrintify() {
  console.log("\n🖨️  Printify API...");
  try {
    const shops = await getShops();
    ok(`Shops: ${shops.map((s) => `${s.title} (${s.sales_channel})`).join(", ")}`);

    const blueprints = await getBlueprints();
    ok(`Blueprints available: ${blueprints.length}`);

    // Show a few relevant ones
    const keywords = ["t-shirt", "tshirt", "mug", "poster"];
    const relevant = blueprints.filter((b) =>
      keywords.some((kw) => b.title.toLowerCase().includes(kw))
    );
    if (relevant.length > 0) {
      console.log("  Relevant blueprints (sample):");
      relevant.slice(0, 5).forEach((b) => {
        console.log(`    [${b.id}] ${b.title} — ${b.brand}`);
      });
    }
  } catch (err) {
    fail("Printify API", err);
  }
}

async function main() {
  console.log("🚀 Semana 1 — Test de conexión a las 3 APIs\n");
  console.log("=".repeat(50));

  await testGeminiText();
  await testGeminiImage();
  await testEtsy();
  await testPrintify();

  console.log("\n" + "=".repeat(50));
  console.log("✅ Tests completados. Revisa los ❌ si los hay.\n");
}

main().catch(console.error);
