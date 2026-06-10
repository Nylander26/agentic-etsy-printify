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
  anchorUrgency: EventUrgency | null;   // urgency of that event (for sorting + UI grouping)
  daysUntilEvent: number | null;        // days until the anchor event
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

// ─── Urgency rank for sorting (lower = more urgent) ───────────────────────────
const URGENCY_RANK = { critical: 0, active: 1, upcoming: 2, planning: 3 } as const;

function buildEventBlock(events: UpcomingEvent[]): string {
  if (events.length === 0) return "No upcoming events in this window — propose evergreen niches only.";

  const byUrgency: Record<string, UpcomingEvent[]> = {};
  for (const e of events) {
    (byUrgency[e.urgency] ??= []).push(e);
  }

  const sections: string[] = [];

  const labels: Record<string, string> = {
    critical: "🔴 CRITICAL — purchase window closing soon (act immediately)",
    active:   "🟠 ACTIVE — purchase window open right now",
    upcoming: "🟡 UPCOMING — window opens within 14 days (prepare now)",
    planning: "🟢 PLANNING — window opens soon (plan ahead)",
  };

  for (const urgency of ["critical", "active", "upcoming", "planning"] as const) {
    const group = byUrgency[urgency];
    if (!group?.length) continue;
    sections.push(labels[urgency] ?? urgency);
    for (const e of group) {
      const kws = e.keywords.map((k) => `"${k}"`).join(", ");
      sections.push(`  • ${eventLabel(e)} [${e.podCategory}]`);
      sections.push(`    Keyword seeds: ${kws}`);
    }
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
YOUR TASK
Propose exactly ${targetCount} Etsy-searchable POD keyword niches, ALL anchored to the calendar events above.
Distribute evenly across events, prioritizing CRITICAL and ACTIVE ones (2-3 niches each).

RULES
1. Each keyword must be 2-5 words, Etsy-search-friendly (e.g. "funny dad bbq shirt", "juneteenth freedom shirt").
2. ${productRule}
3. Each niche must target the specific buyer identity for its event (gift-givers, celebrants, fans).
4. Do NOT propose evergreen or non-event niches — every candidate must map to a listed event.
5. Do NOT propose news/celebrity/election niches.
6. Sell well to ${cfg.market.audience}: US humor, US holidays, US idioms.
7. For \`anchorEvent\`: use the event name exactly as listed above. Never null.

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

  console.log(`\nDiscovery — market=${cfg.market.country}, lookahead=${lookahead}d, candidatos=${targetCount}\n`);

  // Step 1: Build calendar context
  const events = getUpcomingEvents(today, lookahead);
  if (events.length === 0) {
    console.log("  (sin eventos en la ventana — modo evergreen)");
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

  // Step 3: Sort by event urgency then expectedDemand — no Apify here
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
      source: "auto-discovery" as const,
      sampledListings: 0,
      avgPrice: null,
      avgTitlePreview: [],
    };
  });

  niches.sort((a, b) => {
    const aEvent = events.find((e) => e.name === a.anchorEvent);
    const bEvent = events.find((e) => e.name === b.anchorEvent);
    const aRank = aEvent ? URGENCY_RANK[aEvent.urgency] : 99;
    const bRank = bEvent ? URGENCY_RANK[bEvent.urgency] : 99;
    if (aRank !== bRank) return aRank - bRank;
    return b.expectedDemand - a.expectedDemand;
  });

  return niches;
}

// ── Shared selection UI (used by both pipeline.runDiscovery and discover-cli) ──

const URGENCY_HEADER: Record<EventUrgency, string> = {
  critical: "🔴 CRÍTICO — la ventana de compra cierra pronto",
  active: "🟠 ACTIVO — la gente está comprando AHORA",
  upcoming: "🟡 PRÓXIMO — la ventana abre en breve (preparar)",
  planning: "🟢 PLANIFICAR — con tiempo por delante",
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
    const eventTag =
      n.anchorEvent && n.anchorUrgency
        ? URGENCY_COLOR[n.anchorUrgency](
            `${n.anchorEvent}${n.daysUntilEvent != null ? ` · ${n.daysUntilEvent}d` : ""}`
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
      colors.dim(`(mayor urgencia + demanda estimada)`)
    : "";
  const note = colors.dim(
    "  Nota: la demanda real solo se confirma publicando — esto prioriza por urgencia de fecha + estimación de Gemini."
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
