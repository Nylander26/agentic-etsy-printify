# agent-publish-etsy-printify

Pipeline automatizado que investiga nichos en Etsy, genera diseños POD con IA y los publica vía Printify — con validación manual antes de publicar.

## Flujo

```
pnpm pipeline
    │
    ├─ [1] Research ──────────────────────────────────────────────
    │      Lee seeds de config.yaml → busca listings en Etsy
    │      Gemini Pro analiza competencia y puntúa cada nicho
    │      Guarda top N nichos en research-results/YYYY-MM-DD.json
    │      (Deduplicado: no re-investiga nichos de los últimos 7 días)
    │
    ├─ [2] Generación ────────────────────────────────────────────
    │      Por cada nicho: Gemini Pro genera prompt → imagen vía Gemini Flash
    │      3 variaciones por concepto: base / oscuro / sin texto
    │      Post-procesado: remove background (tshirts) + resize a dims Printify
    │      Output: output/YYYY-MM-DD/{nicho}/{design-id}/
    │      (Deduplicado: no regenera diseños de los últimos 14 días)
    │
    ├─ [3] PAUSA — tú revisas ────────────────────────────────────
    │      Notificación Telegram: "35 diseños listos"
    │      Ejecutas en otra terminal: pnpm review
    │        [A] Aprobar → mueve a approved/
    │        [R] Rechazar → mueve a rejected/
    │        [G] Regenerar → queda en pending
    │        [S] Saltar
    │      Presionas ENTER para continuar
    │
    └─ [4] Publicación ───────────────────────────────────────────
           Lee approved/ → sube imagen a Printify
           Gemini Pro genera título SEO + descripción + 13 tags
           Calcula precio (coste base + margen configurado)
           Publica en Etsy vía Printify
           Notificación Telegram: "22 productos publicados ✓"
```

## Setup

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus keys:

| Variable | Dónde obtenerla |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://ai.google.dev) |
| `ETSY_CLIENT_ID` / `ETSY_CLIENT_SECRET` | [Etsy Developers](https://developers.etsy.com) |
| `PRINTIFY_API_TOKEN` | [Printify → Account → API](https://printify.com/app/account/api) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Opcional — [@BotFather](https://t.me/botfather) |

### 3. Autorizar Etsy (una sola vez)

```bash
pnpm tsx src/lib/etsy-auth.ts
```

Abre la URL que aparece en consola → autoriza en el browser → callback automático. Guarda tokens en `.etsy-tokens.json`.

### 4. Verificar conexión a las 3 APIs

```bash
pnpm test:apis
```

Debe mostrar ✅ para Gemini texto, Gemini imagen, Etsy y Printify.

### 5. Ajustar configuración

Edita `config.yaml`:

```yaml
research:
  keywords_seed:         # tus nichos objetivo
    - "funny cat"
    - "dog mom"
  max_niches: 5          # top N a procesar
  min_demand_score: 6    # filtro de calidad (1-10)

generation:
  designs_per_niche: 5   # conceptos por nicho
  products:
    - tshirt
    - mug
    - poster

publishing:
  margin_percent: 50     # margen sobre coste Printify
  max_publish_per_run: 25
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm pipeline` | Flujo completo (research → generate → review → publish) |
| `pnpm research --seeds "kw1,kw2"` | Solo investigar nichos |
| `pnpm generate --niche "funny cat" --products tshirt,mug` | Solo generar diseños |
| `pnpm generate --from-research` | Genera desde el último research |
| `pnpm review` | Revisar diseños pendientes (A/R/G/S) |
| `pnpm publish` | Publicar diseños aprobados |
| `pnpm stats` | Dashboard de ventas y rendimiento |
| `pnpm test:apis` | Verificar conexión a las 3 APIs |
| `pnpm typecheck` | Verificar tipos TypeScript |

## Estructura de archivos generados

```
output/
└── 2026-04-20/
    └── funny-cat/
        └── funny-cat-001-tshirt-base/
            ├── original.png      ← imagen generada por Gemini
            ├── nobg.png          ← sin fondo (solo tshirts)
            └── metadata.json     ← concepto, prompt, status

approved/                         ← diseños que aprobaste
rejected/                         ← diseños que rechazaste
research-results/
└── 2026-04-20.json               ← top 10 nichos con scores y design ideas
pipeline.sqlite                   ← estado, deduplicación, histórico de runs
```

## Notas importantes

**Límites del free tier de Gemini:**
- Imágenes: 10 req/min → el pipeline usa 8 para tener margen
- ~500 imágenes/día en Google AI Studio → suficiente para 25 productos/semana
- Las imágenes incluyen watermark invisible SynthID (no afecta calidad visual)

**Blueprint IDs de Printify** (`src/publisher/blueprint-map.ts`):
- Los IDs de variantes (tallas, colores) son aproximados. Antes de publicar en producción, verifica con `pnpm test:apis` que los blueprint IDs corresponden a los productos que tienes configurados en tu tienda Printify.

**Etsy tokens:**
- Se guardan en `.etsy-tokens.json` (en .gitignore). Si expiran, vuelve a ejecutar `pnpm tsx src/lib/etsy-auth.ts`.
