# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated pipeline (Node.js + TypeScript) that researches Etsy niches, generates POD designs via AI, and publishes to Etsy through Printify — with a mandatory manual validation step before publishing.

**Status:** Pre-development. Reference: `plan-agentico-etsy-v2.md` for full architecture and weekly roadmap.

## Stack & AI Services

- **Runtime:** Node.js + TypeScript (`pnpm`)
- **Text/Research AI:** Gemini Pro (`@google/generative-ai`)
- **Image generation:** `gemini-2.5-flash-image` (Nano Banana) — free tier, max 10 req/min, throttle to 8
- **Vision validator:** Gemini 1.5 Pro multimodal — free tier 50 RPD / 2 RPM, throttle to 5 RPM
- **Marketplace research:** Apify scraper-as-a-service for Etsy SERP (the Etsy OAuth app is unavailable — Apify routes US residential proxies on its side)
- **APIs:** Printify REST (Etsy direct API is OUT — bypassed via Printify draft → manual publish from Printify dashboard)
- **Storage:** SQLite for state/tracking, JSON files for pipeline output

## Planned Commands

```bash
pnpm run discover                                # Standalone preview: which niches the agent would pick
pnpm run research --seeds "keyword1,keyword2"    # Manual seeds (overrides auto-discovery)
pnpm run research                                # Uses auto-discovery if research.auto_discover=true
pnpm run generate --niche "niche name" --products tshirt,mug,poster
pnpm run validate     # AI agent evaluates each pending-validation design vs niche/market fit
pnpm run review       # Interactive CLI to approve/reject pre-validated designs
pnpm run publish      # Creates Printify drafts from approved designs
pnpm run pipeline     # Full orchestrated run (discover → research → generate → validate → notify → review → publish)
pnpm run stats        # Weekly dashboard: views, favs, sales per listing
```

## Architecture

Seven sequential modules, each independent and runnable standalone:

```
src/research/discovery → Google Trends dailyTrends + Gemini POD filter + Apify cross-validation
src/research/          → Per-keyword Trends + Apify + Gemini niche scoring
src/generator/         → Prompt engineering + Nano Banana image gen + sharp post-processing
src/validator/         → Gemini Vision agent (niche-aware rubric, market-fit checks, regenerate loop with hard cap)
src/reviewer/          → CLI review UI (approve/reject) — shows validator scores when available
src/publisher/         → Printify upload + Gemini SEO metadata + Etsy pack JSON
src/monitor/           → Etsy stats polling + feedback loop + weekly dashboard
```

**Approval gates (CLI + optional Telegram in parallel via `src/lib/approval.ts`):**
1. After discovery → user selects which discovered niches proceed to generation.
2. After validator rejection → user picks regenerate/skip/force-approve per design.

**Pipeline state machine:**
`pending-validation/` → validator IA →
  ├─ approved/borderline → `pending-review/` → (manual A/R) → `approved/` or `rejected/` → publish
  ├─ rejected → user prompt: regenerate (capped) | skip | force-approve

Design output structure: `output/{date}/{niche}/{design-id}/` containing original image, background-removed image, and `metadata.json`. Regenerated designs get suffix `-r1`, `-r2`, etc. up to `validator.max_regenerations`.

**SQLite tables:** `niches`, `designs`, `products`, `stats` — prevents duplicate research/generation runs.

## Key Constraints

- Gemini image throttle: hard limit at 8 req/min (stay under the 10/min free tier cap)
- Etsy rate limit: 10 req/sec
- Image resolution: Nano Banana outputs 1024×1024 natively; upscale if Printify blueprint requires larger
- Pricing formula: Printify base cost + configurable margin (default 50%) with psychological rounding
- Niche scoring formula: `(demanda × 2 + margen) / competencia`

## Configuration

Pipeline behavior controlled via `config.yaml`. Key sections:
- `market`: country/currency/language/audience — propagated to Trends, Apify, and validator system prompt. Default: US.
- `research`: seed keywords, niche scoring thresholds.
- `generation`: designs per niche, products, style preference.
- `validator`: `max_regenerations` (default 2), `approval_threshold` (6.5), `borderline_threshold` (5.0), `vision_model`, `enforce_market_fit`.
- `publishing`: margin, max per run.

API keys via `.env`:
- `GEMINI_API_KEY` — text + image + vision
- `PRINTIFY_API_TOKEN`
- `APIFY_TOKEN`, `APIFY_ETSY_ACTOR_ID` (optional override; default actor: `automation-lab~etsy-scraper`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (for notifications)

Note: Etsy direct API is NOT used (the user's dev app is blocked). Listings are created as Printify DRAFTs and published manually from the Printify dashboard or via the generated Etsy pack JSON.

## Skills Available

Installed via `npx skills` (see `skills-lock.json`). These are external skill definitions in `.agents/skills/` — not Claude Code plugins. Reference the SKILL.md files there for TypeScript and Node.js patterns when implementing modules.
