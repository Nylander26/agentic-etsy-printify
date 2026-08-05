/**
 * Autonomous niche discovery — calendar-anchored.
 *
 * Uses a structured US POD event calendar (calendar.ts) to anchor niche
 * proposals to real upcoming purchase windows, then cross-validates each
 * candidate with an Apify Etsy listing sample to confirm marketplace presence.
 *
 * Flow:
 *   1. getUpcomingEvents(today, discovery_window_days) → events sorted by urgency
 *   2. Gemini proposes 2-3 niches per active/upcoming event + evergreen filler
 *   3. User selects 1 (or more) — no Apify calls here
 *   4. Research phase validates the selected keyword with Apify Etsy + Pinterest (same as always)
 *
 * Apify is NOT called during discovery — it runs only in research on the selected keyword,
 * exactly as it did before auto-discovery existed. This keeps the Apify budget identical
 * to a manual keywords_seed run (1 Etsy call + 1 Pinterest call per selected niche).
 *
 * Caller (research/index.ts or pipeline.ts) asks the user which candidates proceed.
 */
import { generateJSON } from "../lib/gemini.js";
import { getConfig } from "../lib/config.js";
import { askApproval } from "../lib/approval.js";
import { colors, scoreBar, padVisible } from "../lib/colors.js";
import { getUpcomingEvents, eventLabel } from "./calendar.js";
import { readSalesFeedback, hasSignal, type SalesFeedback } from "../lib/sales-feedback.js";
import { allowedProductNouns, forbiddenProductNouns, keywordMatchesProducts } from "./product-coherence.js";
import type { ApprovalOption } from "../lib/approval.js";
import type { UpcomingEvent, EventUrgency } from "./calendar.js";
import type { ProductType } from "../generator/types.js";

export interface DiscoveredNiche {
  keyword: string;
  rationale: string;                    // Gemini's justification for this niche
  expectedDemand: number;               // 1-10 from Gemini
  anchorEvent: string | null;           // calendar event that drove this niche (null = evergreen)
  anchorUrgency: EventUrgency | null;   // urgency of that event (for UI grouping)
  daysUntilEvent: number | null;        // days until the anchor event
  runwayDays: number | null;            // days until the purchase window CLOSES — drives ranking
  source: "auto-discovery";
  // Apify fields — NOT populated during discovery (validation happens in research)
  sampledListings: 0;
  avgPrice: null;
  avgTitlePreview: [];
}

interface GeminiCandidate {
  keyword: string;
  rationale: string;
  expectedDemand: number;
  anchorEvent: string | null;
}

interface GeminiDiscoveryResponse {
  candidates: GeminiCandidate[];
}

/**
 * Ranking for the discovery list.
 *
 * NOT by urgency. Urgency measures how soon an event's window closes, so ranking by
 * it recommends whichever event has the LEAST time left — which is how the Father's
 * Day batch happened: published 13 days before the event, never ranked, 1 visit in
 * two months. `min_publish_lead_days` filters the hopeless cases, but a candidate
 * sitting one day above that floor is still nearly hopeless, and urgency-first put it
 * at the top with a star next to it.
 *
 * A brand-new listing needs weeks of impressions before Etsy ranks it, so within the
 * lookahead window MORE runway is strictly better. Ties break on Gemini's demand
 * estimate, then on the keyword so the order is stable across runs.
 *
 * (Runway can't run away with it: `discovery_window_days` already caps how far out an
 * event can be, so this never recommends seeding Christmas in January.)
 */
export function compareByRunway(a: DiscoveredNiche, b: DiscoveredNiche): number {
  const ar = a.runwayDays ?? -1;
  const br = b.runwayDays ?? -1;
  if (ar !== br) return br - ar;
  if (a.expectedDemand !== b.expectedDemand) return b.expectedDemand - a.expectedDemand;
  return a.keyword.localeCompare(b.keyword);
}

function buildEventBlock(events: UpcomingEvent[]): string {
  if (events.length === 0) return "No upcoming events in this window — propose evergreen niches only.";

  // Most runway first — that is the order we want proposals weighted in, and the model
  // anchors on whatever it reads first.
  const sections: string[] = [];
  for (const e of [...events].sort((a, b) => b.daysUntilWindowClose - a.daysUntilWindowClose)) {
    const kws = e.keywords.map((k) => `"${k}"`).join(", ");
    sections.push(
      `  • ${eventLabel(e)} [${e.podCategory}] — ${e.daysUntilWindowClose} days of runway ` +
        `before its purchase window closes`
    );
    // Shown so the model knows the territory — and explicitly NOT as a menu to copy.
    // Left as "seeds" it just hands them back reworded, and these are the head terms
    // a shop with no sales history cannot rank for.
    sections.push(`    Saturated head terms for this event — DO NOT return these or reworded variants: ${kws}`);
  }

  return sections.join("\n");
}

/**
 * Builds the "what actually sells" prompt block from the sales feedback artifact.
 * Empty string when there's no real sales signal yet — keeping discovery neutral
 * pre-launch. Closes the loop: monitor (Printify orders) → discovery proposals.
 */
function buildSalesContextBlock(fb: SalesFeedback): string {
  const cats = Object.entries(fb.categoryUnits)
    .sort((a, b) => b[1] - a[1])
    .map(([c, u]) => `${c} (${u} sold)`)
    .join(", ");

  const topWinners = fb.winners
    .slice(0, 8)
    .map((w) => `  • "${w.niche}" — ${w.units} sold${w.category ? ` [${w.category}]` : ""}`)
    .join("\n");

  return [
    "REAL SALES FEEDBACK (actual orders from our own Etsy store — the strongest signal):",
    cats ? `Best-selling categories so far: ${cats}.` : "",
    "Proven niches (already made sales):",
    topWinners,
    "Use this to:",
    "  - Favor the best-selling categories above when choosing among the calendar events.",
    "  - For proven niches, propose FRESH adjacent angles / new concepts (NOT the same keyword again).",
  ]
    .filter(Boolean)
    .join("\n");
}

async function geminiProposePodNiches(
  events: UpcomingEvent[],
  targetCount: number,
  salesContext: string
): Promise<GeminiCandidate[]> {
  const cfg = getConfig();
  const today = new Date().toISOString().slice(0, 10);
  const eventBlock = buildEventBlock(events);
  const products = cfg.generation.products as ProductType[];
  const allowed = allowedProductNouns(products);
  const forbidden = forbiddenProductNouns(products);

  const productRule =
    forbidden.length > 0
      ? `Keywords may ONLY use these product words: ${allowed.join(", ")}. ` +
        `NEVER use: ${forbidden.join(", ")} (we don't produce those). ` +
        `Prefer product-agnostic keywords (no product word at all) when natural.`
      : `Keywords may use any of these product words: ${allowed.join(", ")}, or none.`;

  const prompt = `
You are a Print-on-Demand (POD) niche scout for the ${cfg.market.audience} segment on Etsy.

Today is ${today}.
We currently produce ONLY: ${products.join(", ")}.

UPCOMING US POD PURCHASE WINDOWS
${eventBlock}
${salesContext ? `\n${salesContext}\n` : ""}
WHO IS ASKING
A small store with no sales history and no ranking authority. It cannot win a head term.
It can only win a narrow query where few sellers compete and the buyer knows exactly what
they want. A listing also needs WEEKS of impressions before Etsy ranks it, so an event with
more runway is worth more to us than an event people are buying from today.

YOUR TASK
Propose exactly ${targetCount} Etsy-searchable POD keyword niches, ALL anchored to the calendar events above.
Give the MOST niches to the events with the MOST runway, fewest to the events closing soonest.

RULES
1. Each keyword must be 3-5 words of long-tail search intent — the phrase a specific buyer
   types, not the category. It must name a concrete buyer identity, relationship, job,
   hobby or in-joke: "nurse halloween costume shirt", "cat mom witch shirt",
   "pregnant halloween announcement shirt" — NOT "halloween shirt", "spooky season shirt".
2. Reject your own candidate if a store with zero sales could not plausibly rank for it,
   or if it is a listed head term with a word swapped ("tee" for "shirt", "witchy" for "witch").
3. ${productRule}
4. Do NOT propose evergreen or non-event niches — every candidate must map to a listed event.
5. Do NOT propose news/celebrity/election niches.
6. Sell well to ${cfg.market.audience}: US humor, US holidays, US idioms.
7. For \`anchorEvent\`: use the event name exactly as listed above. Never null.
8. \`expectedDemand\` (1-10) rates how many buyers search THAT EXACT phrase. A narrow
   phrase scoring 5 is a better business than a head term scoring 9 we can never rank for.
   Use the full range — do not cluster every candidate at 7-8.
9. \`rationale\`: one sentence naming the buyer and why they buy. No marketing filler.

OUTPUT (strict JSON, no markdown):
{
  "candidates": [
    { "keyword": "...", "rationale": "...", "expectedDemand": 8, "anchorEvent": "Father's Day" },
    { "keyword": "...", "rationale": "...", "expectedDemand": 7, "anchorEvent": null },
    ...
  ]
}

Return exactly ${targetCount} candidates.
`.trim();

  const result = await generateJSON<GeminiDiscoveryResponse>(prompt);
  return result.candidates ?? [];
}

export async function discoverNiches(): Promise<DiscoveredNiche[]> {
  const cfg = getConfig();
  const today = new Date();
  const lookahead = cfg.research.discovery_window_days;
  const targetCount = cfg.research.discovery_candidates;
  const minLead = cfg.research.min_publish_lead_days;

  console.log(
    `\nDiscovery — market=${cfg.market.country}, lookahead=${lookahead}d, ` +
      `lead mínimo=${minLead}d, candidatos=${targetCount}\n`
  );

  // Step 1: Build calendar context. Events whose purchase window closes within
  // `minLead` days are dropped — a listing published into them can't rank in time.
  const events = getUpcomingEvents(today, lookahead, minLead);
  if (events.length === 0) {
    const anyEvent = getUpcomingEvents(today, lookahead).length;
    if (anyEvent > 0) {
      console.log(
        `  (${anyEvent} evento(s) descartados: su ventana cierra en <${minLead}d — ` +
          `sin runway para rankear → modo evergreen)`
      );
    } else {
      console.log("  (sin eventos en la ventana — modo evergreen)");
    }
  } else {
    console.log(`  Calendario: ${events.length} eventos en los próximos ${lookahead} días`);
    for (const e of events) {
      console.log(`    [${e.urgency.toUpperCase()}] ${eventLabel(e)}`);
    }
  }

  // Step 1b: Sales feedback (R2) — bias proposals toward what actually sells.
  // No-op until real Printify orders exist (gated by hasSignal).
  const salesFeedback = readSalesFeedback();
  let salesContext = "";
  if (hasSignal(salesFeedback)) {
    salesContext = buildSalesContextBlock(salesFeedback);
    const cats = Object.entries(salesFeedback.categoryUnits)
      .sort((a, b) => b[1] - a[1])
      .map(([c, u]) => `${c}=${u}u`)
      .join(", ");
    console.log(`\n  📈 Sesgo por ventas reales activo — categorías: ${cats || "(ninguna inferida)"}`);
    console.log(`     ${salesFeedback.winners.length} nicho(s) ganador(es) → se piden variaciones nuevas`);
  }

  // Step 2: Gemini proposes niches anchored to events (0 Apify calls)
  console.log("\n  Gemini proponiendo nichos anclados al calendario...");
  const rawCandidates = await geminiProposePodNiches(events, targetCount, salesContext);
  console.log(`  ${rawCandidates.length} candidatos propuestos`);

  if (rawCandidates.length === 0) {
    console.warn("  Gemini no devolvió candidatos. Revisar prompt.");
    return [];
  }

  // Step 2b: Drop candidates whose keyword names a product we don't produce
  // (belt-and-suspenders — the prompt already forbids it).
  const products = cfg.generation.products as ProductType[];
  const candidates = rawCandidates.filter((c) => {
    if (keywordMatchesProducts(c.keyword, products)) return true;
    console.log(`    ⊘ "${c.keyword}" — descartado (producto no configurado)`);
    return false;
  });
  if (candidates.length < rawCandidates.length) {
    console.log(`  ${candidates.length} candidatos tras filtro de producto`);
  }

  // Step 3: Rank by runway (see compareByRunway) — no Apify here.
  // Apify validation happens in research on the keyword the user selects.
  const niches: DiscoveredNiche[] = candidates.map((c) => {
    const event = c.anchorEvent ? events.find((e) => e.name === c.anchorEvent) : undefined;
    return {
      keyword: c.keyword,
      rationale: c.rationale,
      expectedDemand: c.expectedDemand,
      anchorEvent: c.anchorEvent ?? null,
      anchorUrgency: event?.urgency ?? null,
      daysUntilEvent: event?.daysUntilEvent ?? null,
      runwayDays: event?.daysUntilWindowClose ?? null,
      source: "auto-discovery" as const,
      sampledListings: 0,
      avgPrice: null,
      avgTitlePreview: [],
    };
  });

  niches.sort(compareByRunway);

  return niches;
}

// ── Shared selection UI (used by both pipeline.runDiscovery and discover-cli) ──

const URGENCY_HEADER: Record<EventUrgency, string> = {
  critical: "🔴 CRÍTICO — la ventana cierra ya: una listing nueva NO llega a rankear",
  active: "🟠 ACTIVO — se compra ahora, pero queda poco margen para posicionar",
  upcoming: "🟡 PRÓXIMO — la ventana abre en breve",
  planning: "🟢 CON MARGEN — tiempo de sobra para que la listing acumule impresiones",
};

const URGENCY_COLOR: Record<EventUrgency, (s: string | number) => string> = {
  critical: colors.red,
  active: colors.yellow,
  upcoming: colors.green,
  planning: colors.gray,
};

/**
 * Build a colored, aligned, urgency-grouped list for the CLI. Numbers match the
 * 1-based index of `niches` (already sorted by urgency), so parsing stays valid.
 */
function renderDiscoveryList(niches: DiscoveredNiche[]): string {
  const numW = String(niches.length).length;
  const kwW = Math.min(28, Math.max(...niches.map((n) => n.keyword.length)));

  const lines: string[] = [];
  let lastUrgency: EventUrgency | null | undefined = undefined;

  niches.forEach((n, i) => {
    // Group header when urgency changes
    if (n.anchorUrgency !== lastUrgency) {
      lastUrgency = n.anchorUrgency;
      const header = n.anchorUrgency
        ? URGENCY_COLOR[n.anchorUrgency](colors.bold(URGENCY_HEADER[n.anchorUrgency]))
        : colors.bold(colors.gray("⚪ EVERGREEN — sin fecha"));
      lines.push("", `  ${header}`);
    }

    const num = colors.bold(String(i + 1).padStart(numW));
    const kw = colors.cyan(padVisible(n.keyword, kwW));
    const bar = scoreBar(n.expectedDemand);
    const demand = `${bar} ${colors.bold(n.expectedDemand)}/10`;
    // Runway (days until the purchase window closes), not days until the event — runway
    // is what decides whether a listing published today can still rank in time.
    const eventTag =
      n.anchorEvent && n.anchorUrgency
        ? URGENCY_COLOR[n.anchorUrgency](
            `${n.anchorEvent}${n.runwayDays != null ? ` · ${n.runwayDays}d de margen` : ""}`
          )
        : colors.gray("evergreen");
    const star = i === 0 ? "  ⭐" : "";

    lines.push(`   ${num}. ${kw}  demanda ${demand}  ${eventTag}${star}`);
    lines.push(`       ${colors.dim(n.rationale.slice(0, 88))}`);
  });

  // Footer: recommendation + reply syntax
  const top = niches[0];
  const recLine = top
    ? `  ⭐ ${colors.bold("Recomendado")}: ${colors.cyan(`#1 "${top.keyword}"`)} ` +
      colors.dim(
        top.runwayDays != null
          ? `(${top.runwayDays}d de margen — el mayor de la lista — + demanda estimada)`
          : `(demanda estimada)`
      )
    : "";
  const note = colors.dim(
    "  Nota: ordenado por MARGEN (días hasta que cierra la ventana de compra), no por urgencia:\n" +
      "  una listing nueva necesita semanas de impresiones antes de rankear. La demanda real solo se confirma publicando."
  );
  const replies = [
    "",
    recLine,
    note,
    "",
    `  ${colors.bold("Responde")}:`,
    `    ${colors.cyan("1")}        → procesar ese (recomendado: de a uno)`,
    `    ${colors.cyan("1,3")}      → varios`,
    `    ${colors.cyan("all")}      → todos`,
    `    ${colors.cyan("cancel")}   → abortar`,
  ];

  return [...lines, ...replies].join("\n");
}

/** One plain approval option per niche — used by Telegram (no ANSI). */
export function discoveredNicheOption(n: DiscoveredNiche): ApprovalOption {
  return {
    label: n.keyword,
    detail: [
      n.anchorEvent ? `[${n.anchorEvent}]` : "[evergreen]",
      `demand≈${n.expectedDemand}/10`,
      n.rationale.slice(0, 80),
    ].join(" · "),
  };
}

/**
 * Present discovered niches and return the user's selection. Single source of
 * truth for the discovery approval gate — both the pipeline and the standalone
 * CLI call this so the prompt + parsing never diverge.
 */
export async function selectDiscoveredNiches(
  title: string,
  niches: DiscoveredNiche[]
): Promise<DiscoveredNiche[]> {
  const choice = await askApproval(title, niches.map(discoveredNicheOption), {
    cliRender: `${colors.bold(title)}\n${renderDiscoveryList(niches)}`,
  });
  if (choice.kind === "cancel") return [];
  if (choice.kind === "all") return niches;
  return choice.indices
    .map((i) => niches[i])
    .filter((n): n is DiscoveredNiche => n != null);
}
