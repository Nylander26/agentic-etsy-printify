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

### R2 — Cerrar el loop: ventas reales → discovery
- Hoy: `src/monitor/` lee Printify orders (`winner_min_units`, `loser_window_days`)
  pero esos datos no influyen en nada.
- Idea: niche ganador → más variaciones / fan-out a mug+poster; categoría que vende
  → sesgar el próximo discovery (calendar.ts podCategory) hacia ese patrón.
- Única señal de demanda REAL del stack. Bloqueado hasta que la tienda salga de dev
  mode (~mediados junio 2026) y haya ventas; dejar listo mientras tanto.

### R3 — Guard de presupuesto por run
- Trackear gasto por run (nº imágenes Gemini × costo + llamadas Apify) y un techo
  configurable en config.yaml que aborta antes de pasarse.
- Hoy el único freno es el gate de confirmación manual ([1.5/6] en pipeline).

## Calidad / robustez

### R4 — Dedup por perceptual-hash
- pHash sobre la imagen final + comparar contra los últimos N runs antes de generar.
- Evita regenerar diseños casi-idénticos (gasta dinero + crea listings duplicados que
  Etsy penaliza). Complementa el dedup por arte subido ya hecho en Printify.

### R5 — Minar SEO de la competencia
- El scraper de Etsy (`apify-source.ts`) ya devuelve títulos top; hoy se usan poco.
- Extraer tags/keywords de alta frecuencia de los listings mejor rankeados y alimentar
  la metadata SEO del publisher (`src/publisher/seo.ts`) → mejor ranking. Dato ya pagado.

### R6 — Tests de la lógica pura
- No hay tests. Ideal para testear barato (funciones puras):
  - `src/research/calendar.ts` — matemática de fechas (nth-weekday, Easter, ventanas)
  - `src/research/product-coherence.ts` — match de productos en keywords
  - `src/lib/colors.ts` — `scoreBar`, `padVisible`
  - `src/research/niche-filter.ts` — gates de calificación
- Previene regresiones en la lógica más tocada en esta iteración.

Recomendación de arranque: **R1** (mayor multiplicador de negocio), luego **R2**
cuando haya tráfico. **R3** y **R6** son baratos y dan red de seguridad.
