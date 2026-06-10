/**
 * Monitor — the post-publication feedback loop.
 * Usage: pnpm stats
 *
 * This is the ONLY real, programmatic sales signal we have: Etsy's API is
 * unavailable, so we read actual orders from Printify (the token carries the
 * `orders.read` scope) and turn them into a per-niche / per-design dashboard.
 *
 * Strategy (see the pod-sales-strategy skill): don't predict winners before
 * launch — measure them after. This surfaces:
 *   • WINNERS  → designs with real sales worth scaling (more variations / products)
 *   • LOSERS   → designs drafted long ago with zero sales, candidates to retire
 *
 * Sales are mapped Printify order → product_id → draft-index → design → niche.
 */
import "dotenv/config";
import { getShops, getOrders, type PrintifyOrder } from "../lib/printify.js";
import { allDrafts } from "../lib/draft-index.js";
import { recordSalesSnapshot, previousUnitsByProduct, type SalesRow } from "../lib/db.js";
import { getConfig } from "../lib/config.js";
import { inferPodCategory, type PodCategory } from "../research/calendar.js";
import { writeSalesFeedback, type WinnerNiche, type SalesFeedback } from "../lib/sales-feedback.js";

/** Derives the niche slug from a design id like "first-father-s-day-001-mug-no-text". */
function nicheFromDesignId(designId: string): string {
  const m = designId.match(/^(.+?)-\d{3}\b/);
  return m ? (m[1] as string) : designId;
}

interface ProductAgg {
  printifyId: string;
  designId: string | null;
  niche: string | null;
  title: string | null;
  product: string | null;
  draftedAt: string | null;
  units: number;
  revenue: number;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function aggregate(orders: PrintifyOrder[]): {
  byProduct: Map<string, { units: number; revenue: number }>;
  totalUnits: number;
  totalRevenue: number;
  countedOrders: number;
} {
  const byProduct = new Map<string, { units: number; revenue: number }>();
  let totalUnits = 0;
  let totalRevenue = 0;
  let countedOrders = 0;

  for (const order of orders) {
    if (order.status === "canceled") continue;
    countedOrders++;
    for (const li of order.line_items ?? []) {
      const units = li.quantity ?? 0;
      const revenue = ((li.metadata?.price ?? 0) * units) / 100;
      const cur = byProduct.get(li.product_id) ?? { units: 0, revenue: 0 };
      cur.units += units;
      cur.revenue += revenue;
      byProduct.set(li.product_id, cur);
      totalUnits += units;
      totalRevenue += revenue;
    }
  }
  return { byProduct, totalUnits, totalRevenue, countedOrders };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function main() {
  const cfg = getConfig().monitor;
  const shops = await getShops();
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) {
    console.error("No Printify shop found.");
    process.exit(1);
  }

  console.log(`\n📊 Feedback loop — tienda "${shop.title}" (id=${shop.id})\n`);

  const [orders, drafts] = await Promise.all([getOrders(shop.id), Promise.resolve(allDrafts())]);
  const { byProduct, totalUnits, totalRevenue, countedOrders } = aggregate(orders);

  // Build the full product universe from the draft index, enriched with sales.
  // Products with no draft-index entry but with sales still show up (mapped by id only).
  const draftByPid = new Map(drafts.map((d) => [d.printifyProductId, d]));
  const allPids = new Set<string>([...draftByPid.keys(), ...byProduct.keys()]);

  const rows: ProductAgg[] = [...allPids].map((pid) => {
    const d = draftByPid.get(pid);
    const sales = byProduct.get(pid) ?? { units: 0, revenue: 0 };
    return {
      printifyId: pid,
      designId: d?.designId ?? null,
      niche: d ? nicheFromDesignId(d.designId) : null,
      title: d?.title ?? null,
      product: d?.product ?? null,
      draftedAt: d?.draftedAt ?? null,
      units: sales.units,
      revenue: sales.revenue,
    };
  });

  // Persist a snapshot for trend history, then compute delta vs the previous snapshot.
  // History is a nice-to-have — if SQLite is unavailable (e.g. native bindings not
  // built), still render the live dashboard from Printify orders, which is the real signal.
  let prevUnits = new Map<string, number>();
  try {
    prevUnits = previousUnitsByProduct();
    recordSalesSnapshot(
      rows.map<SalesRow>((r) => ({
        printifyId: r.printifyId,
        designId: r.designId,
        niche: r.niche,
        title: r.title,
        units: r.units,
        revenue: r.revenue,
      }))
    );
  } catch (err) {
    console.warn(`  ⚠️  Histórico SQLite no disponible (${err instanceof Error ? err.message : err}) — sigo con datos en vivo.\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const withSales = rows.filter((r) => r.units > 0);
  console.log("┌─ Resumen ──────────────────────────────────────────────");
  console.log(`│ Productos publicados (drafted):  ${drafts.length}`);
  console.log(`│ Órdenes contabilizadas:          ${countedOrders}`);
  console.log(`│ Unidades vendidas:               ${totalUnits}`);
  console.log(`│ Ingresos (retail):               ${money(totalRevenue)}`);
  console.log(`│ Productos con >=1 venta:         ${withSales.length}/${rows.length}`);
  console.log("└────────────────────────────────────────────────────────");

  if (totalUnits === 0) {
    console.log(
      "\nℹ️  Aún sin ventas registradas en Printify.\n" +
        "   Recordá: los drafts deben publicarse a Etsy (dashboard de Printify) para poder vender.\n" +
        "   Cuando lleguen ventas, este comando marcará ganadores y perdedores automáticamente.\n"
    );
  }

  // ── Per-niche breakdown ──────────────────────────────────────────────────
  const byNiche = new Map<string, { units: number; revenue: number; products: number }>();
  for (const r of rows) {
    const key = r.niche ?? "(sin nicho)";
    const cur = byNiche.get(key) ?? { units: 0, revenue: 0, products: 0 };
    cur.units += r.units;
    cur.revenue += r.revenue;
    cur.products += 1;
    byNiche.set(key, cur);
  }
  const nichesSorted = [...byNiche.entries()].sort((a, b) => b[1].units - a[1].units);
  if (nichesSorted.length > 0) {
    console.log("\n📦 Por nicho (ordenado por unidades):");
    for (const [niche, s] of nichesSorted) {
      console.log(`   ${s.units}u · ${money(s.revenue)} · ${s.products} productos — "${niche}"`);
    }
  }

  // ── Winners → scale ──────────────────────────────────────────────────────
  const winners = withSales
    .filter((r) => r.units >= cfg.winner_min_units)
    .sort((a, b) => b.units - a.units);
  if (winners.length > 0) {
    console.log(`\n🏆 GANADORES (>= ${cfg.winner_min_units}u) — escalar (más variaciones / más productos):`);
    for (const w of winners) {
      const delta = w.units - (prevUnits.get(w.printifyId) ?? 0);
      const deltaStr = prevUnits.size > 0 ? ` (+${delta} desde último check)` : "";
      console.log(`   ${w.units}u · ${money(w.revenue)} — "${(w.title ?? w.printifyId).slice(0, 55)}"${deltaStr}`);
      if (w.niche) console.log(`      → nicho "${w.niche}" — generá más en este nicho: pnpm generate --niche "${w.niche}"`);
    }
  }

  // ── Losers → retire ───────────────────────────────────────────────────────
  const losers = rows.filter((r) => {
    if (r.units > 0) return false;
    const age = daysSince(r.draftedAt);
    return age !== null && age >= cfg.loser_window_days;
  });
  if (losers.length > 0) {
    console.log(`\n🪦 BAJO RENDIMIENTO (0 ventas, drafted hace >= ${cfg.loser_window_days}d) — considerá retirar:`);
    for (const l of losers.slice(0, 20)) {
      console.log(`   ${daysSince(l.draftedAt)}d · "${(l.title ?? l.printifyId).slice(0, 55)}" (${l.printifyId})`);
    }
    if (losers.length > 20) console.log(`   ... y ${losers.length - 20} más`);
    console.log(`   Para retirarlos de Printify (y Etsy): usá scripts/nuke-all-listings.ts o borralos manualmente.`);
  }

  // ── Feedback loop: persist sales signal for the next discovery run (R2) ─────
  // Decoupled — discovery reads this JSON, no import back to the monitor. Niches
  // with real sales (and their inferred POD category) bias future proposals.
  const winnerNiches: WinnerNiche[] = nichesSorted
    .filter(([niche, s]) => s.units > 0 && niche !== "(sin nicho)")
    .map(([niche, s]) => ({
      niche,
      units: s.units,
      revenue: s.revenue,
      category: inferPodCategory(niche),
    }));

  const categoryUnits: Partial<Record<PodCategory, number>> = {};
  for (const w of winnerNiches) {
    if (w.category) categoryUnits[w.category] = (categoryUnits[w.category] ?? 0) + w.units;
  }

  const feedback: SalesFeedback = {
    generatedAt: new Date().toISOString(),
    totalUnits,
    winners: winnerNiches,
    categoryUnits,
  };
  const fbPath = writeSalesFeedback(feedback);

  if (totalUnits > 0) {
    const catStr =
      Object.entries(categoryUnits)
        .sort((a, b) => b[1] - a[1])
        .map(([c, u]) => `${c}=${u}u`)
        .join(", ") || "(sin categoría inferida)";
    console.log(`\n🔁 Feedback para discovery guardado en ${fbPath}`);
    console.log(`   Categorías que venden: ${catStr}`);
    console.log(`   El próximo 'pnpm discover' / 'pnpm pipeline' sesgará las propuestas hacia esto.`);
  } else {
    console.log(`\n🔁 Feedback guardado (sin ventas aún) — discovery sigue neutral hasta que haya órdenes.`);
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Monitor failed:", err);
    process.exit(1);
  });
