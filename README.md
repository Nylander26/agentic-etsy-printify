# agent-publish-etsy-printify

Pipeline automatizado que investiga nichos POD vía Google Trends, genera diseños con IA y los sube a Printify como drafts — con validación manual antes de subir. La publicación a Etsy es manual (no requiere API dev de Etsy).

## Flujo

```
pnpm pipeline
    │
    ├─ [1] Research ──────────────────────────────────────────────
    │      Lee seeds de config.yaml → consulta Google Trends
    │      (interés temporal + queries relacionadas + tendencia)
    │      Gemini Pro analiza cada nicho con Trends + conocimiento POD
    │      Guarda top N nichos en research-results/YYYY-MM-DD.json
    │      (Deduplicado: no re-investiga nichos de los últimos 7 días)
    │
    ├─ [2] Generación ────────────────────────────────────────────
    │      Por cada nicho: Gemini genera prompt → imagen vía Nano Banana 2
    │      3 variaciones por concepto: base / oscuro / sin texto
    │      Post-procesado: resize a dims Printify
    │      Output: output/YYYY-MM-DD/{nicho}/{design-id}/
    │
    ├─ [3] PAUSA — tú revisas ────────────────────────────────────
    │      Notificación Telegram (opcional): "X diseños listos"
    │      Ejecutas en otra terminal: pnpm review
    │        [A] Aprobar → mueve a approved/
    │        [R] Rechazar → mueve a rejected/
    │        [G] Regenerar → queda en pending
    │        [S] Saltar
    │      Presionas ENTER para continuar
    │
    └─ [4] Publicación a Printify (DRAFT) ────────────────────────
           Lee approved/ → sube imagen a Printify
           Gemini Pro genera título SEO + descripción + 13 tags
           Calcula precio (coste base + margen configurado)
           Crea el producto como DRAFT en Printify
           Genera un Etsy pack JSON+MD en data/etsy-packs/

    [5] Publicación a Etsy (MANUAL) ─────────────────────────────
        Opción A: Printify dashboard → Products → "Publish" a tu
                  tienda Etsy vinculada
        Opción B: Abre el .md del pack y copia-pega
                  título/descripción/tags al crear el listing en Etsy
```

> **Sin API de Etsy.** Este pipeline no usa la API de Etsy (no requiere cuenta dev aprobada). El último paso a Etsy es manual.

## Setup

### 1. Instalar dependencias

```bash
pnpm install
```

(El primer install construye binarios nativos de `sharp` y `better-sqlite3`. Si pnpm pregunta por build scripts, se aprueban automáticamente vía la sección `pnpm.onlyBuiltDependencies` del package.json.)

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus keys:

| Variable | Dónde obtenerla |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://ai.google.dev) |
| `PRINTIFY_API_TOKEN` | [Printify → Account → API](https://printify.com/app/account/api) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Opcional — [@BotFather](https://t.me/botfather) |

### 3. Vincular tienda Etsy en Printify

En la web de Printify: **Account → My stores → Connect → Etsy**. Esto deja la tienda Etsy enlazada para poder pulsar "Publish" en cada draft desde el dashboard.

### 4. Verificar conexión a APIs

```bash
pnpm test:apis
```

Debe mostrar ✅ para Gemini texto, Gemini imagen, Google Trends y Printify.

### 5. Ajustar configuración

Edita `config.yaml`:

```yaml
research:
  keywords_seed:           # tus nichos objetivo
    - "funny cat"
    - "dog mom"
  max_niches: 5            # top N a procesar
  min_demand_score: 6      # filtro de calidad (1-10)
  geo: "US"                # región de Google Trends (US, ES, MX, GB...)

generation:
  designs_per_niche: 5     # conceptos por nicho
  products:
    - tshirt
    - mug
    - poster
  remove_background: false # off por defecto (lib actual crashea en win+libvips)

publishing:
  margin_percent: 50       # margen sobre coste Printify
  max_publish_per_run: 25

gemini:
  model_text: "gemini-2.5-flash"
  model_image: "gemini-3.1-flash-image-preview"   # Nano Banana 2
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm pipeline` | Flujo completo (research → generate → review → publish-drafts) |
| `pnpm research --seeds "kw1,kw2"` | Solo investigar nichos vía Google Trends |
| `pnpm generate --niche "funny cat" --products tshirt,mug` | Solo generar diseños |
| `pnpm generate --from-research` | Genera desde el último research |
| `pnpm review` | Revisar diseños pendientes (A/R/G/S) |
| `pnpm publish-drafts` | Crear drafts en Printify + generar etsy-pack |
| `pnpm test:apis` | Verificar conexión a Gemini / Trends / Printify |
| `pnpm typecheck` | Verificar tipos TypeScript |

## Estructura de archivos generados

```
output/
└── 2026-05-15/
    └── funny-cat/
        └── funny-cat-001-tshirt-base/
            ├── original.png      ← imagen generada por Nano Banana 2
            ├── resized.png       ← redimensionada a dims Printify
            └── metadata.json     ← concepto, prompt, status

approved/                         ← diseños que aprobaste
rejected/                         ← diseños que rechazaste

research-results/
└── 2026-05-15.json               ← top N nichos con scores y design ideas

data/etsy-packs/
└── 2026-05-15/
    ├── batch-001.json            ← printifyProductId + título + desc + tags
    └── batch-001.md              ← versión copy-paste-friendly

pipeline.sqlite                   ← estado, deduplicación, histórico de runs
```

## Notas importantes

**Google Trends sin API oficial.** Se usa `google-trends-api` (npm) que llama a los endpoints internos del frontend de Trends. Sin auth, sin cuotas oficiales, pero rate-limit agresivo por IP. El pipeline espacia las peticiones 6s. Si te marca por IP (devuelve HTML 429), espera 1–2h o sube el `GAP_MS` en [src/research/trends-source.ts](src/research/trends-source.ts).

**Límites del free tier de Gemini:**
- Imágenes: ~10 req/min → el pipeline usa 8 para tener margen
- Las imágenes generadas con `gemini-3.1-flash-image-preview` (Nano Banana 2) incluyen watermark invisible SynthID (no afecta calidad visual)
- Si Nano Banana 2 falla, el diseño se omite (no hay fallback automático — Pro genera con cortes y errores frecuentes)

**Background removal off por defecto.** `@imgly/background-removal-node` segfaulta en Windows con libvips actual. Hasta sustituir la lib, los diseños se guardan con el fondo original (Printify acepta fondo blanco perfectamente para muchos casos). Para reactivar: `generation.remove_background: true` en config.yaml.

**Blueprint IDs de Printify** ([src/publisher/blueprint-map.ts](src/publisher/blueprint-map.ts)):
- IDs verificados contra la API en mayo 2026. Cuando Printify los cambie verás error `8251` al publicar. Cómo refrescarlos: [docs/blueprints.md](docs/blueprints.md).
