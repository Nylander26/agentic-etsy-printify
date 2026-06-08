# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated pipeline (Node.js + TypeScript) that researches Etsy niches, generates POD designs via AI, and publishes to Etsy through Printify. An AI vision validator scores each design; under the default **hybrid review**, designs that clear the approval threshold auto-promote to `approved/` while only borderline / force-approved designs require manual review before publishing.

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
pnpm run clean        # Prune old regenerable assets (output/ + stale approved) to last keep_runs runs; --apply to delete
```

## Architecture

Seven sequential modules, each independent and runnable standalone:

```
src/research/discovery → Google Trends dailyTrends + Gemini POD filter + Apify cross-validation
src/research/          → Per-keyword Trends + Apify + Gemini niche scoring
src/generator/         → Prompt engineering + Nano Banana image gen + sharp post-processing
src/validator/         → Gemini Vision agent (niche-aware rubric, market-fit checks, auto-regenerate loop with hard cap, hybrid auto-approve)
src/reviewer/          → CLI review UI for borderline/force-approved only — batch [AA]/[RA] or per-design A/R/G/S ([G] regenerates via the SAME image model)
src/lib/design-store   → shared design state helpers (walkDesigns / moveDesign / writeMeta) used by validator, reviewer, publisher, pipeline
src/publisher/         → Printify upload + Gemini SEO metadata + Etsy pack JSON
src/monitor/           → Etsy stats polling + feedback loop + weekly dashboard
```

**Approval gates (CLI + optional Telegram in parallel via `src/lib/approval.ts`):**
1. After discovery → user selects which discovered niches proceed to generation.
2. Manual review (`pnpm review`) → only borderline + force-approved designs reach it; supports batch approve-all `[AA]` / reject-all `[RA]` or per-design `A/R/G/S`. AI-approved designs skip this gate when `validator.auto_approve_passing=true`.

**Pipeline state machine (hybrid review — `validator.auto_approve_passing` + `validator.auto_regenerate`):**
`pending-validation/` → validator IA (Gemini Vision) →
  ├─ approved (≥ approval_threshold) → `approved/` directly → publish              (auto_approve_passing=true)
  ├─ borderline / force-approved     → `pending-review/` → (manual A/R/G) → `approved/`|`rejected/` → publish
  └─ rejected → auto-regenerate (SAME image model + validator hints) → re-validate, capped at `max_regenerations`, else `rejected/`   (auto_regenerate=true)

With `auto_approve_passing=false` every passing design goes through manual review; with `auto_regenerate=false` rejections fall back to the interactive regenerate/skip/force-approve menu. Regeneration always reuses the original image model (`generateDesign` → `generateImage` → `gemini.model_image`) — never a different/lower-quality API.

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
- `validator`: `max_regenerations` (default 2), `approval_threshold` (6.5), `borderline_threshold` (5.0), `vision_model`, `enforce_market_fit`, `auto_approve_passing` (default true — AI-approved skip manual review), `auto_regenerate` (default true — rejected auto-regenerate up to the cap).
- `publishing`: margin, max per run.

API keys via `.env`:
- `GEMINI_API_KEY` — text + image + vision
- `PRINTIFY_API_TOKEN`
- `APIFY_TOKEN`, `APIFY_ETSY_ACTOR_ID` (optional override; default actor: `automation-lab~etsy-scraper`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (for notifications)

Note: Etsy direct API is NOT used (the user's dev app is blocked). Listings are created as Printify DRAFTs and published manually from the Printify dashboard or via the generated Etsy pack JSON.

## Skills Available

Installed via `npx skills` (see `skills-lock.json`). These are external skill definitions in `.agents/skills/` — not Claude Code plugins. Reference the SKILL.md files there for TypeScript and Node.js patterns when implementing modules.
