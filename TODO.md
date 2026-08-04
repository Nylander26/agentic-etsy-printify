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

---

# Roadmap tráfico + ventas (propuestas — 2026-06-10)

Análisis post R2-R7. Contexto: tienda sale de dev mode ~mediados de junio (Father's Day
21-jun = primera ventana real de ventas), sin API de Etsy, Pinterest API pendiente de
aprobación (R1). Estas propuestas atacan el cuello de botella real: **tráfico** (nadie ve
los listings) y **conversión** (los que llegan no compran). Ordenadas por leverage.

## Tráfico

### R8 — Pin pack manual (puente a R1, tráfico YA sin esperar aprobación)
- Problema: R1 (auto-publicar pins) está bloqueado en la aprobación de la app Pinterest.
  Mientras tanto, 0 tráfico Pinterest — y es la fuente #1 para POD.
- Propuesta: `pnpm pin-pack` — por cada diseño publicado (draft-index), generar en
  `data/pin-packs/{fecha}/`:
  - Imagen 2:3 (1000×1500) lista para pin: mockup del producto compuesto vía sharp
    (Pinterest castiga el 1:1; el 2:3 es el formato que distribuye).
  - `pins.md` copy-paste: título del pin (≤100 chars, keyword-first), descripción
    (≤500, keywords de `competitor-seo`), link directo al listing de Etsy, board sugerido.
- Pinnear a mano son 2 min/diseño con el pack hecho. Cuando aprueben la app, R1 reusa
  estos MISMOS assets/copy y solo agrega la llamada API → cero trabajo tirado.
- Sin coste de API (solo sharp + 1 llamada Gemini texto por diseño, ya cubierta por budget).

### R9 — Escalar ganadores: fan-out de productos sobre arte PROBADO
- Hoy el monitor detecta winners y solo imprime "generá más en este nicho". La mitad más rentable del consejo es automatizable: mismo arte, más superficies.
- Propuesta: `pnpm scale-winners` — para cada winner (`sales-feedback.json` + draft-index), crear drafts en blueprints adicionales (mug 459, poster 15 — ya mapeados en
  `blueprint-map.ts`) **reutilizando el arte ya subido a Printify** (content-addressed:
  mismo image id, $0 en Gemini imagen). Solo cuesta SEO texto + llamadas Printify.
- Respeta la regla NUNCA-reintentar-createProduct (chequear draft-index antes de crear:
  designId+product ya existente = skip).
- Gateado por ventas reales igual que R2 — no hace nada hasta que haya winners.

## Conversión / SEO

### R10 — Re-SEO estacional de listings vivos (calendar-driven)
- Etsy rankea recencia + relevancia estacional. Un listing "funny dad shirt" genérico
  pierde contra uno con framing "Father's Day Gift" durante la ventana de compra.
- Propuesta: `pnpm seo-refresh` — cruza `calendar.ts` (eventos en ventana de compra)
  con los listings vivos (draft-index + `inferPodCategory` del nicho). Para los que
  matchean un evento próximo, regenera título/tags con framing del evento (reusa
  `generateSEO` + `competitor-seo`) y escribe un pack `data/seo-refresh/{fecha}/` para
  pegar a mano en Etsy (igual flujo que el etsy-pack actual).
- Incluir en el pack el recordatorio de atributos Etsy (Holiday/Occasion) que hoy no
  se setean — son señal de ranking en búsquedas estacionales y se ponen en 5 segundos.
- Bonus barato: el mismo comando lista losers (0 ventas > `loser_window_days`) como
  candidatos a re-SEO total en vez de retiro (un listing muerto a veces revive con
  título/tags nuevos — gratis vs generar arte nuevo).

## Medición (sin API de Etsy)

### R11 — Rank tracker: posición de TUS listings en la SERP de Etsy (Apify)
- Hoy no hay forma de saber si el SEO funciona hasta que hay una venta. Apify ya
  scrapea la SERP de Etsy (infra + caché + budget ya hechos) — solo falta buscarse
  a uno mismo.
- Propuesta: `pnpm rank` — para las keywords principales de cada listing publicado
  (título/tags del draft-index), correr la búsqueda Apify y registrar en SQLite
  (tabla `rank_history`) la posición de nuestros listings (match por shop name,
  nuevo `market.shop_name` en config).
- Output: tabla keyword × posición × delta vs último check. Detecta qué tags mueven
  ranking → alimenta R10 (re-SEO con data, no a ciegas).
- Coste controlado: pasa por `charge("apify")` + caché; correr semanal, no por pipeline.

## Conversión (menor prioridad)

### R12 — Video de listing (Etsy da boost a listings con video)
- Etsy prioriza en search y muestra en hover los listings con video; la mayoría de
  sellers POD no lo ponen → ventaja barata.
- Propuesta: `pnpm listing-videos` — MP4 de 5-10s por diseño (ken-burns zoom/pan
  sobre los mockups de Printify, ffmpeg estático sin reencode pesado) →
  `data/videos/{fecha}/`. Subida manual al listing (la API de Etsy no está, igual
  que todo lo demás).
- Requiere dependencia nueva (ffmpeg binario o ffmpeg-static) — único de la lista
  que mete tooling nuevo; por eso va último.

---

Único pendiente previo: **R1** (Pinterest API v5 — mayor multiplicador, pero requiere
crear y que aprueben la app Pinterest antes de construir nada). **R8 lo puentea**:
tráfico Pinterest manual ya, mismos assets cuando aprueben.
R2/R3/R4/R5/R6/R7 hechos. R2 a validar con ventas reales cuando la tienda salga de dev mode.
Nuevos propuestos: R8 (pin pack) > R9 (scale winners) > R10 (re-SEO estacional) >
R11 (rank tracker) > R12 (video). Sin empezar.
