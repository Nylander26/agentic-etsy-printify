/**
 * Validator system prompt + rubric.
 *
 * Anchored to the `market.audience` from config so the agent evaluates against
 * the configured market (default: US Etsy buyers). If the user expands to other
 * regions later, only `config.yaml::market` changes — no code edits needed.
 */
import { getConfig } from "../lib/config.js";
import type { NicheContext, ValidationResult } from "../generator/types.js";

export function buildValidatorPrompt(
  niche: NicheContext | undefined,
  designConcept: string,
  designStyle: string,
  product: string,
  variation: string
): string {
  const cfg = getConfig();
  const market = cfg.market;
  const validator = cfg.validator;
  const audience = market.audience;
  const culturalRules = validator.enforce_market_fit
    ? `\nCULTURAL FIT IS A HARD REQUIREMENT for the ${audience} segment. If you detect any of the following, DROP the overall score by at least 3 points and add a blocker:
- Non-English text or text in a dialect inappropriate for ${market.country} (e.g. British spellings for a US-only shop)
- References to holidays not celebrated in ${market.country}
- Humor or idioms that don't translate to the target audience
- Religious/political references inappropriate for mass-market Etsy buyers`
    : "";

  const nicheBlock = niche
    ? `
Niche context (from research pipeline):
- Keyword: "${niche.keyword}"
- Demand score: ${niche.demandScore}/10
- Competition score: ${niche.competitionScore}/10
- Avg market price: $${niche.avgPrice.toFixed(2)} (${market.currency})
- Trend direction: ${niche.trendDirection}
- Top SEO tags in this niche: ${niche.topTags.slice(0, 10).join(", ") || "(none)"}
${niche.topTitles.length > 0 ? `- Sample top listings:\n${niche.topTitles.slice(0, 6).map((t) => `  • ${t}`).join("\n")}` : ""}
`.trim()
    : "Niche context: not available (design generated without research data).";

  return `
You are a senior Etsy POD (print-on-demand) curator with 10 years of experience selling EXCLUSIVELY to the ${market.country} market. You evaluate whether a design will sell to ${audience}.

Your reference is the current ${market.country} POD market on Etsy: current visual trends, US humor sensibilities (mom culture, dog/cat parents, nurse/teacher life, hobby identity, etc.), US-relevant holidays (Halloween, Thanksgiving, 4th of July, US Mother's/Father's Day, Christmas), American English idioms, US sizing conventions, and Etsy's typical print-on-demand aesthetic.

DESIGN UNDER REVIEW
- Concept: "${designConcept}"
- Style description: "${designStyle}"
- Product: ${product}
- Variation: ${variation}

${nicheBlock}

EVALUATION RUBRIC

Score each dimension 1-10. Anchor descriptions:

1. nicheRelevance — does the image actually represent the keyword/niche for a ${audience} buyer?
   1-3: off-topic or generic; 4-6: tangentially related; 7-8: clearly on-niche; 9-10: nails the niche with a specific, memorable angle.

2. trendAlignment — does the visual style match what's currently selling on Etsy US in this category?
   1-3: dated or generic AI-look; 4-6: passable but unremarkable; 7-8: matches current top sellers; 9-10: feels fresh and on-trend.

3. commercialAppeal — would a ${audience} buyer add this to cart at $${niche?.avgPrice.toFixed(2) ?? "20.00"}?
   1-3: no clear use case or gift recipient; 4-6: niche but small audience; 7-8: clear gift/identity appeal; 9-10: strong impulse purchase + giftable.

4. printability — POD-friendly on ${product}?
   1-3: tiny details/gradients that will print muddy, edges bleed; 4-6: workable with caveats; 7-8: clean for DTG/sublimation; 9-10: bold, high-contrast, scales perfectly.
   HARD FAIL: if the background is a transparency CHECKERBOARD / grey-and-white grid pattern
   (the model drew the "transparent" placeholder instead of solid white), set printability = 1
   and verdict = "rejected" — it prints as a literal checkerboard on colored garments. The
   backdrop MUST be solid opaque white (or the artwork's own intended fill).

5. overall — weighted average of the above, BUT cap at 5 if any single score is ≤3.
${culturalRules}

OUTPUT FORMAT (strict JSON, no markdown fences)

{
  "verdict": "approved" | "borderline" | "rejected",
  "scores": {
    "nicheRelevance": <1-10>,
    "trendAlignment": <1-10>,
    "commercialAppeal": <1-10>,
    "printability": <1-10>,
    "overall": <1-10>
  },
  "reasons": {
    "strengths": [<1-3 short strings, what's working>],
    "concerns": [<0-3 short strings, what could be better>],
    "blockers": [<0-4 short strings, ONLY if verdict = "rejected" — concrete deal-breakers>]
  },
  "suggestedImprovements": [<2-4 actionable hints to feed into a regeneration prompt; concrete and specific>]
}

Thresholds:
- overall >= ${validator.approval_threshold} → "approved"
- ${validator.borderline_threshold} <= overall < ${validator.approval_threshold} → "borderline"
- overall < ${validator.borderline_threshold} → "rejected"

Be honest. Don't inflate scores to be polite. The seller relies on your judgment.
`.trim();
}

/**
 * Sanity-check the JSON returned by the model and coerce missing fields.
 * The model occasionally drops `blockers` or `concerns`; we ensure arrays exist.
 */
export function normalizeValidation(
  raw: Partial<ValidationResult> & { scores?: Partial<ValidationResult["scores"]> },
  modelName: string
): ValidationResult {
  const cfg = getConfig();
  const scores = {
    nicheRelevance: clamp(raw.scores?.nicheRelevance, 1, 10, 5),
    trendAlignment: clamp(raw.scores?.trendAlignment, 1, 10, 5),
    commercialAppeal: clamp(raw.scores?.commercialAppeal, 1, 10, 5),
    printability: clamp(raw.scores?.printability, 1, 10, 5),
    overall: clamp(raw.scores?.overall, 1, 10, 5),
  };

  // Derive verdict from overall + thresholds, ignoring model's stated verdict
  // when it conflicts with the configured thresholds.
  let verdict: ValidationResult["verdict"];
  if (scores.overall >= cfg.validator.approval_threshold) verdict = "approved";
  else if (scores.overall >= cfg.validator.borderline_threshold) verdict = "borderline";
  else verdict = "rejected";

  return {
    verdict,
    scores,
    reasons: {
      strengths: raw.reasons?.strengths ?? [],
      concerns: raw.reasons?.concerns ?? [],
      blockers: verdict === "rejected" ? raw.reasons?.blockers ?? [] : [],
    },
    suggestedImprovements: raw.suggestedImprovements ?? [],
    evaluatedAt: new Date().toISOString(),
    model: modelName,
  };
}

function clamp(v: number | undefined, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}
