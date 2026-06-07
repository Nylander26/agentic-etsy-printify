---
name: pod-sales-strategy
description: >-
  The decision-making playbook for THIS Etsy + Printify POD pipeline: how to pick niches,
  how to measure what actually sells, and how to keep the project focused on quality over
  quantity. Use this skill WHENEVER the user asks how to find a winning niche, "what sells",
  how to analyze purchase/sales/demand trends, whether to scale a product or kill it, whether
  to buy a research tool (eRank, Everbee, SerpApi, DataForSEO, an Apify actor), how many
  designs/products/niches to generate, or US-vs-other-market questions. Trigger it even when
  the user doesn't say "strategy" — any niche-selection, demand-research, sales-data-source,
  batch-sizing, or scaling decision on this project should consult this skill FIRST, so the
  same hard-won conclusions are applied instead of re-derived or re-researched from scratch.
---

# POD Sales Strategy (Etsy + Printify pipeline)

This skill encodes decisions already made and validated for this project. Its purpose is to
**stop re-litigating settled questions** (especially "how do I find a niche that sells before
publishing?") and to keep every decision pointed at the durable edge: **quality + a real
post-publication feedback loop**.

Read the relevant section, apply it, and move on. Do not re-run the actor probes or re-explain
the analysis below unless new evidence contradicts it.

## The one constraint everything follows from

**There is no reliable, free, programmatic source of Etsy *sales* data before you publish.**

This was investigated empirically, not assumed:

- **Etsy hides per-listing sales.** Search result cards expose price, currency, rating, and
  search position — never a sales or review count.
- **The Etsy-native research tools (eRank, Everbee, Sale Samurai) have no public API.** Gating
  the data is their business model. They cannot be wired into an automated flow.
- **Apify actors that *do* return sales/review counts** (e.g. `khadinakbar/etsy-all-in-one-scraper`)
  use a headless browser and get blocked by Etsy's DataDome anti-bot — verified returning **0
  items after 8 retries** on different IPs. They are not dependable inside a pipeline that needs
  data on every run.
- **The robust actor we use (`automation-lab~etsy-scraper`)** pulls clean data reliably, but it
  is **search-card only**: no review count, no sales count, no detail/URL mode. Confirmed from
  its input schema.

**Implication — do NOT:**
- Try to build or recommend a "find the winning niche before launch" data feed. It doesn't exist
  cheaply and reliably.
- Casually recommend a paid subscription (SerpApi ≈ $50/mo, DataForSEO, etc.) to "solve" niche
  discovery. The user has explicitly declined to spend money just to *explore* niches. Only raise
  a paid tool if the user asks for a stronger pre-launch demand signal AND accepts the cost — and
  even then, frame it as a *demand/interest* signal (search volume), never as sales data.
- Fabricate a demand or sales number from an LLM's training priors. We deliberately removed the
  faked `estMonthlySales = rating × 10` and forbade Gemini from inventing sales figures. A weak
  *real* signal beats a confident *fake* one.

## The durable edge: the post-publication feedback loop

Because pre-launch sales prediction is impossible, **stop trying to predict winners and start
measuring them.** The only sales signal that is real, free, and programmatic is **your own data**:

- The Printify API token already carries the `orders.read` scope → real orders/sales per product.
- Etsy listing stats (views, favorites) supplement it.

The operating strategy is therefore a loop, not a one-shot prediction:

```
publish a SMALL, high-quality batch
        ↓
read REAL sales via Printify orders API   ← the only true signal
        ↓
scale what sells · kill what doesn't · expand winners to more products
        ↓
repeat
```

This is the `src/monitor/` module in the plan (currently scaffolded). When the user wants to
"find what sells", the right answer is almost always **"publish a small batch and let the loop
tell us"**, not "let's research harder before launching."

## Quality over quantity — the default posture

The user has chosen quality over volume. Honor it in every recommendation:

- **Default batch is intentionally small.** Current config: **1 niche, 1 product (tshirt),
  front-only design.** This caps Gemini image cost and Etsy fees while testing the loop.
- When asked to generate more, prefer **going deeper on a proven winner** (more variations,
  expand a selling design to new products) over **going wider** (more unproven niches).
- Do not balloon the numbers back up (the pipeline *can* do 5 niches × fan-out = 225 drafts;
  that is the opposite of the chosen strategy). If a change would multiply unproven output,
  flag it against this principle before doing it.
- Etsy charges $0.20 only when a draft is actually published from the Printify dashboard — so
  drafts are cheap, but **published junk is not** (listing fees + diluted shop quality). Quality
  gating (the AI validator + manual review for borderline) stays on.

## The pre-launch signal we DO use (and its honest ceiling)

For choosing among niches before launch, use the best *automatable* proxy — and treat it as a
prior, not a prediction:

- **Apify `automation-lab` sample**: real prices, titles, ratings, and search `position`.
- **`topRating`** = average rating of the top-positioned listings (Etsy ranks best-converting
  listings first under `most_relevant`), plus sample depth and price spread. This is a *weak but
  real* demand/quality proxy implemented in `src/research/apify-source.ts`.
- **Gemini** synthesizes these into a `demandScore`, grounded ONLY in the real signals, explicitly
  barred from inventing sales numbers (`src/research/niche-analyzer.ts`).

Be honest about the ceiling: this tells you a niche is *active and monetized*, not that *you* will
sell. That confirmation only comes from the feedback loop above.

## Market: stay US

US is the chosen market (`market.country: US`) and should stay unless the user wants a
Spanish-language, locally-cultural niche. Rationale, so it isn't re-debated:

- Vastly larger Etsy buyer base than ES; English designs travel.
- Printify print providers concentrated in the US → cheap/fast shipping, economy shipping already enabled.
- Seasonal timing aligns with US holidays (e.g. US Father's Day = 3rd Sunday of June, distinct
  from Spain's March 19). The user lives in Madrid, but selling is remote — physical location is
  irrelevant to market choice.

## How to apply this skill in a conversation

1. If the question is "how do I find a niche that sells / analyze sales trends" → explain the loop,
   point at Printify orders data, and steer toward publishing a small batch. Don't re-research actors.
2. If the question is "should I buy/integrate <research tool>" → default no (cost + no API for the
   Etsy-native ones); only entertain a paid *demand* tool if the user explicitly accepts the cost.
3. If the request would scale up unproven output → push back toward quality/depth on winners.
4. If asked about market → US, with the reasoning above.
5. Keep answers short and decisive. The value here is *not repeating the investigation* — the
   conclusions are settled until real new evidence (e.g. a working sales API) appears.
