# TODO — Publisher / Generator

Implementado #1, #2, #3, #5, #6, #7, #8 y entregado el análisis #4 (`docs/heavy-image-upload-analysis.md`). Ver historial de git para el detalle.

## Limpieza de duplicados — HECHA (2026-05-21)

- Borrados **55 drafts duplicados** vía `pnpm dedup --apply`.
- Dedup por **arte subido** (Printify almacena content-addressed → mismo image id = mismo diseño), no por título.
- Publicados a Etsy (103) intactos; diseños únicos intactos.
- Estado final: **184 productos** (103 publicados, 81 drafts), **0 duplicados**.

No quedan pendientes.

---

# Roadmap / Ideas (pendientes — 2026-06-10)

Propuestas tras agregar discovery anclado al calendario, señal Pinterest y
unificación de flujos (commit `5b427a4`). Ordenadas por leverage. Sin empezar.

## Alto impacto

### R1 — Pinterest API oficial: migrar lectura + agregar PUBLICACIÓN
- Hoy: `src/research/pinterest-source.ts` lee la señal vía Apify (actor
  `fatihtahta~pinterest-scraper-search`). Apify solo LEE, no puede publicar pins.
- Decisión (2026-06-10): migrar TODO a la **Pinterest API v5 oficial** — una sola
  integración hace lectura (señal de visibilidad) Y escritura (publicar pins).
  Con eso se **retira Pinterest de Apify** (borrar pinterest-source.ts basado en
  Apify + `APIFY_PINTEREST_ACTOR_ID` del .env/env.ts; el `APIFY_TOKEN` sigue para Etsy).
- Idea de publicación: auto-crear un pin por diseño publicado (imagen + título SEO +
  link a Etsy). Pinterest es la fuente de tráfico #1 para POD — sin tráfico no hay
  ventas que medir → ataca directo "no se valida un nicho hasta que vende".
- **PRE-REQUISITO (validar ANTES de construir nada):** crear app de Pinterest + OAuth
  + aprobación de Pinterest para API v5. Igual que pasó con Etsy, el acceso puede
  ser bloqueado/lento — confirmar que aprueban la app antes de comprometerse.
- Alcance al migrar:
  - Reescribir el read-signal sobre la API v5 (mismos campos: engagement/saves reales,
    que la API sí expone, mejor que el proxy promotedRatio+followers del scraper).
  - Nuevo `src/publisher/pinterest.ts` para crear pins desde diseños aprobados.
  - Manejo de OAuth tokens (refresh) en `.env` / `src/lib/`.

### R2 — Cerrar el loop: ventas reales → discovery — HECHO (2026-06-10, dormido)
- Implementado: `pnpm stats` persiste `research-results/sales-feedback.json`
  (winners + unidades por categoría POD inferida vía `calendar.inferPodCategory`).
  `discovery.ts` lo lee y sesga el prompt de Gemini hacia categorías/nichos que
  venden + pide variaciones nuevas de los ganadores. Decoupled (monitor escribe,
  discovery lee) y **gateado** por `hasSignal` → sin efecto con 0 ventas.
- PENDIENTE DE VALIDAR: solo se activa cuando la tienda salga de dev mode y haya
  órdenes reales en Printify. Correr `pnpm stats` tras las primeras ventas y
  confirmar que el siguiente `pnpm discover` muestra "Sesgo por ventas reales activo".

### R3 — Guard de presupuesto por run — HECHO (2026-06-10)
- `src/lib/budget.ts` — tracker singleton por proceso (= 1 run): `charge(category)`
  acumula gasto estimado y lanza `BudgetExceededError` ANTES de la llamada que
  pasaría el tope. Categorías: image/text/vision/apify.
- Hooks en los chokepoints: `gemini.ts` (image/text/json/vision) + `apify-source.ts`
  y `pinterest-source.ts` (solo llamadas reales, post-caché).
- Abort con gracia: `run.ts` corta la generación y devuelve lo ya hecho; el pipeline
  registra el run y reporta el gasto (sin notifyError). Preflight en el gate [1.5/6]
  con estimación de imágenes vs headroom. `budgetReport()` en los summaries.
- Config `budget` (enabled/max_usd_per_run/cost_per_*). Probado: 250 imgs → aborta
  en la #251 a tope $10.

## Calidad / robustez

### R4 — Dedup por perceptual-hash — HECHO (2026-06-10)
- `src/lib/phash.ts` (dHash 64-bit + Hamming vía sharp) + `src/lib/phash-index.ts`
  (store `output/.phash-index.json`, podado a últimos `compare_runs` runs).
- Hook en `src/generator/run.ts` (motor compartido CLI+pipeline): tras generar cada
  imagen, hashea el `original` crudo y, si hay un casi-idéntico en la ventana, lo
  descarta ANTES de post-process/validación/publish → ahorra la llamada Vision y
  evita listings duplicados. Config `generation.dedup_phash` (enabled/max_distance/
  compare_runs, default 5/3). Probado: base vs dark dist=16 (no se matan variaciones),
  idénticos dist=0 (sí se atrapan).

### R5 — Minar SEO de la competencia — HECHO (2026-06-10)
- `src/publisher/competitor-seo.ts` — `mineCompetitorKeywords(titles)`: extrae uni/bi-grams
  de alta frecuencia de los títulos top (prioriza bigramas, dedup por título, gate
  `minTitles` → [] con data pobre, filtra ruido de borde y palabras de producto). Pura/testeable.
- `seo.ts` — `generateSEO` ahora toma un objeto `SEOInput` (corrige el bug posicional del
  precio) e inyecta las keywords de competencia en el prompt Y en el fallback/relleno de tags.
- `publisher/index.ts` — antes pasaba `[]`; ahora mina de `meta.nicheContext.topTitles`
  (dato Apify ya pagado) y lo pasa a la SEO. Probado: 5 títulos de gatos → "cat lover",
  "cat mom", "cat lady", "crazy cat"… (frases reales de búsqueda).

### R6 — Tests de la lógica pura — HECHO (2026-06-10)
- Runner: **Vitest** (`pnpm test` / `pnpm test:watch`). Resuelve specifiers `.js`→`.ts`
  del NodeNext sin config. `vitest.config.ts` + `test/setup.ts` (env dummy de fallback).
- 8 archivos, 52 tests, todos verdes + typecheck limpio:
  - `calendar.test.ts` — nth-weekday/last-weekday/Easter/ventanas + `inferPodCategory`
  - `product-coherence.test.ts` — match de producto en keywords (whole-word)
  - `colors.test.ts` — `scoreBar`, `padVisible`, `visibleLength`
  - `niche-filter.test.ts` — los 3 checkpoints de calificación
  - `phash.test.ts` — Hamming + determinismo del dHash (R4)
  - `competitor-seo.test.ts` — minado de keywords de competencia (R5)
  - `budget.test.ts` — techo por run + estimateCost (R3)
  - `sales-feedback.test.ts` — gate `hasSignal` (R2)

Único pendiente: **R1** (Pinterest API v5 — mayor multiplicador, pero requiere crear
y que aprueben la app Pinterest antes de construir nada).
R2/R3/R4/R5/R6/R7 ya hechos. R2 a validar con ventas reales cuando la tienda salga de dev mode.
