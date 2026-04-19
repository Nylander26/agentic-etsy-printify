# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated pipeline (Node.js + TypeScript) that researches Etsy niches, generates POD designs via AI, and publishes to Etsy through Printify — with a mandatory manual validation step before publishing.

**Status:** Pre-development. Reference: `plan-agentico-etsy-v2.md` for full architecture and weekly roadmap.

## Stack & AI Services

- **Runtime:** Node.js + TypeScript (`pnpm`)
- **Text/Research AI:** Gemini Pro (`@google/generative-ai`)
- **Image generation:** `gemini-2.5-flash-image` (Nano Banana) — free tier, max 10 req/min, throttle to 8
- **APIs:** Etsy OAuth 2.0 (10 req/sec limit), Printify REST
- **Storage:** SQLite for state/tracking, JSON files for pipeline output

## Planned Commands

```bash
pnpm run research --seeds "keyword1,keyword2"   # Research niches, outputs to research-results/YYYY-MM-DD.json
pnpm run generate --niche "niche name" --products tshirt,mug,poster
pnpm run review       # Interactive CLI or HTML viewer to approve/reject designs
pnpm run publish      # Publishes only approved designs to Etsy via Printify
pnpm run pipeline     # Full orchestrated run (research → generate → notify → wait for review → publish)
pnpm run stats        # Weekly dashboard: views, favs, sales per listing
```

## Architecture

Five sequential modules, each independent and runnable standalone:

```
src/research/    → Etsy API scraping + Gemini Pro niche scoring
src/generator/   → Prompt engineering + Nano Banana image gen + rembg post-processing
src/reviewer/    → CLI/HTML review UI (approve/reject/regenerate)
src/publisher/   → Printify upload + Gemini SEO metadata + Etsy publish
src/monitor/     → Etsy stats polling + feedback loop + weekly dashboard
```

**Pipeline state machine:** `pending-review/` → (manual review) → `approved/` or `rejected/` → publish.

Design output structure: `output/{date}/{niche}/{design-id}/` containing original image, background-removed image, and `metadata.json`.

**SQLite tables:** `niches`, `designs`, `products`, `stats` — prevents duplicate research/generation runs.

## Key Constraints

- Gemini image throttle: hard limit at 8 req/min (stay under the 10/min free tier cap)
- Etsy rate limit: 10 req/sec
- Image resolution: Nano Banana outputs 1024×1024 natively; upscale if Printify blueprint requires larger
- Pricing formula: Printify base cost + configurable margin (default 50%) with psychological rounding
- Niche scoring formula: `(demanda × 2 + margen) / competencia`

## Configuration

Pipeline behavior controlled via `config.yaml` (see plan for full schema). API keys via `.env`:
- `GEMINI_API_KEY`
- `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET`
- `PRINTIFY_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (for notifications)

## Skills Available

Installed via `npx skills` (see `skills-lock.json`). These are external skill definitions in `.agents/skills/` — not Claude Code plugins. Reference the SKILL.md files there for TypeScript and Node.js patterns when implementing modules.
