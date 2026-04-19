# Plan de Acción: Flujo Agéntico Etsy + Printify (v2)

## Resumen del proyecto

**Objetivo:** Pipeline automatizado en Node.js/TypeScript que investiga nichos, genera diseños con IA y publica en Etsy vía Printify — con validación manual tuya antes de publicar.

**Presupuesto:** 1.000€
**Tiempo disponible:** 5-10 horas/semana
**Ritmo objetivo:** ~25 productos/semana (ajustable según resultados)
**Timeline:** 8 semanas hasta flujo completo
**Stack:** Node.js + TypeScript
**IA:** Gemini Pro (research + SEO) + Nano Banana (generación de imágenes) — gratis 7-8 meses

---

## Desglose de costes estimados (con Gemini gratis)

| Concepto | Coste mensual |
|----------|--------------|
| Gemini Pro + Nano Banana (imagen) | 0€ (plan gratuito) |
| Printify Premium | ~25€/mes |
| Etsy listing fees (0,20$ × ~100 listings/mes) | ~20€/mes |
| VPS pequeño para cron jobs (Hetzner/Railway) | ~5-10€/mes |
| eRank básico (validar nichos) | ~6€/mes |
| **Total mensual** | **~55-60€/mes** |
| **Reserva operativa 8 meses** | **~450-500€** |
| **Capital libre para emergencias/escala** | **~500€** |

> Con Gemini gratis reduces el coste a menos de la mitad del plan original. Esos 500€ extra son tu colchón para escalar cuando encuentres nichos ganadores.

### Límites de Gemini free tier a tener en cuenta

- Nano Banana (gemini-2.5-flash-image): ~500 requests/día en Google AI Studio — más que suficiente para 25 productos/semana (~5 diseños/día con variaciones)
- Gemini Pro para texto/research: límites generosos en el free tier
- Rate limit: ~10 req/min en imágenes — tu pipeline debe incluir throttling
- Las imágenes generadas incluyen watermark SynthID (invisible para humanos, no afecta calidad visual)
- Resolución nativa: 1024×1024, con opción de 2K en algunos modelos

---

## Arquitectura del flujo agéntico

```
┌─────────────────────────────────────────────────────────────┐
│                   FASE 1: RESEARCH                          │
│                                                             │
│  Etsy API (trending, bestsellers)                           │
│       ↓                                                     │
│  Gemini Pro analiza datos → Score de nicho                  │
│       ↓                                                     │
│  Output: Top nichos + keywords + ideas de diseño            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   FASE 2: GENERACIÓN                        │
│                                                             │
│  Gemini Pro genera prompts optimizados                      │
│       ↓                                                     │
│  Nano Banana genera diseños (1024×1024+)                    │
│       ↓                                                     │
│  Post-procesado: rembg (quitar fondo), resize               │
│       ↓                                                     │
│  Output: Diseños en carpeta /pending-review/                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              FASE 3: VALIDACIÓN MANUAL (TÚ)                 │
│                                                             │
│  CLI interactivo o carpeta con preview:                      │
│    • Ves cada diseño + mockup sobre producto                │
│    • Apruebas (✓), rechazas (✗), o pides regenerar (↻)     │
│    • Los aprobados pasan a /approved/                       │
│                                                             │
│  Meta: revisar batch de ~25 diseños en 15-20 min            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   FASE 4: PUBLICACIÓN                       │
│                                                             │
│  Solo diseños aprobados:                                    │
│    Printify API → crear producto + subir diseño             │
│    Gemini Pro → título SEO + descripción + 13 tags          │
│    Printify → publish a Etsy con pricing automático         │
│                                                             │
│  Output: Listings activos en tu tienda                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   FASE 5: MONITOREO                         │
│                                                             │
│  Etsy API → stats por listing (vistas, favs, ventas)        │
│  Feedback loop:                                             │
│    • Nicho con ventas → generar más variaciones             │
│    • Nicho sin tracción 30d → pausar y rotar                │
│                                                             │
│  Output: Report semanal + ajuste automático de estrategia   │
└─────────────────────────────────────────────────────────────┘
```

---

## Rutina semanal objetivo (5-10h)

| Día | Actividad | Tiempo |
|-----|-----------|--------|
| Lunes | Pipeline ejecuta research automático. Tú revisas top nichos (5 min) | 30 min |
| Martes | Pipeline genera batch de diseños. Tú validas/rechazas | 1-2h |
| Miércoles | Diseños aprobados se publican automáticamente | 15 min supervisión |
| Jueves | Revisar stats de la semana anterior, ajustar keywords o nichos | 1h |
| Viernes | Desarrollo/mejora del pipeline (nuevas features, bug fixes) | 2-3h |
| Weekend | Opcional: research manual de tendencias, explorar nichos nuevos | 0-2h |

---

## Cronograma semana a semana

### SEMANA 1 — Setup del proyecto y APIs (5-8h)

**Objetivo:** Proyecto inicializado con acceso real a las 3 APIs.

**1. Inicializar proyecto (1h)**
- `pnpm init` + TypeScript config + estructura base
- Carpetas: `src/research/`, `src/generator/`, `src/reviewer/`, `src/publisher/`, `src/monitor/`
- Dependencias: `axios`, `dotenv`, `zod`, `@google/generative-ai`

**2. Configurar Gemini API (1-2h)**
- Obtener API key en Google AI Studio (ai.google.dev)
- Instalar SDK: `@google/generative-ai`
- Test 1 — Gemini Pro: enviar prompt de análisis de nicho, verificar respuesta
- Test 2 — Nano Banana: generar imagen de prueba
- Implementar throttle: máximo 10 req/min para imágenes
- Ejemplo de llamada para generar imagen:
  ```typescript
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });
  const result = await model.generateContent("A minimalist t-shirt design...");
  // Extraer imagen del response (viene como base64 inline_data)
  ```

**3. Configurar Etsy API (2-3h)**
- Crear app en developers.etsy.com (si no la tienes)
- Implementar OAuth 2.0 flow completo
- Script test: listar tus listings activos
- Implementar rate limiting (10 req/seg máximo)

**4. Configurar Printify API (1h)**
- Token desde printify.com/app/account/api
- Test: listar tu shop + catálogo de blueprints disponibles
- Mapear IDs de productos que te interesan (camisetas, tazas, pósters, etc.)

**Entregable:** Script que conecta a las 3 APIs y devuelve datos reales.

---

### SEMANA 2 — Módulo de Research (5-8h)

**Objetivo:** Script que identifica nichos rentables automáticamente usando Gemini Pro.

**1. Scraping de tendencias Etsy (3-4h)**
- Buscar listings con alto volumen de ventas por keywords semilla
- Extraer por listing: ventas totales, precio, favoritos, antigüedad de la tienda
- Construir función `searchNiche(keyword): NicheData[]`
- Almacenar resultados en JSON local (SQLite más adelante si lo necesitas)

**2. Análisis con Gemini Pro (2-3h)**
- Enviar datos crudos de Etsy a Gemini Pro con prompt estructurado:
  ```
  Analiza estos datos de Etsy para el nicho "{keyword}".
  Datos: {listings JSON}
  
  Responde SOLO en JSON con este schema:
  {
    "demandScore": 1-10,
    "competitionScore": 1-10,
    "avgPrice": number,
    "estimatedMonthlySales": number,
    "subNiches": ["sub1", "sub2", ...],
    "designIdeas": [
      { "concept": "...", "style": "...", "targetProduct": "tshirt|mug|poster" }
    ],
    "seoKeywords": ["kw1", "kw2", ...]
  }
  ```
- Rankear nichos por fórmula: `(demanda × 2 + margen) / competencia`

**3. Pipeline de research (1h)**
- `pnpm run research --seeds "funny cat,dog mom,nurse life,hiking lover"`
- Output: `research-results/YYYY-MM-DD.json` con top 10 nichos rankeados

**Entregable:** Comando que devuelve los 10 mejores nichos con ideas de diseño.

---

### SEMANA 3 — Módulo de Generación con Nano Banana (5-10h)

**Objetivo:** Pipeline que genera diseños POD de calidad a partir de un nicho.

**1. Prompt engineering para POD (2-3h)**
- Crear templates de prompts por tipo de producto:
  - **Camisetas:** "A minimalist design for a t-shirt on a pure transparent background. [concept]. Clean vector style, suitable for screen printing, centered composition, no mockup."
  - **Tazas:** "A wrap-around mug design, seamless horizontal illustration. [concept]. Vibrant colors, white background, print-ready."
  - **Pósters/Wall art:** "A high-resolution poster artwork. [concept]. [style]. Museum-quality composition, rich detail."
- Nano Banana genera a 1024×1024 nativo — considerar upscaling si el producto lo requiere
- Iterar prompts hasta conseguir calidad consistente (esta es la fase más importante)

**2. Pipeline de generación (2-3h)**
- Input: nicho + ideas de diseño (del research)
- Para cada idea: Gemini Pro optimiza el prompt → Nano Banana genera imagen
- Generar 3 variaciones por concepto (diferentes estilos/colores)
- Post-procesado automático:
  - `rembg` para quitar fondos en diseños de camisetas
  - Resize a dimensiones requeridas por Printify
  - Validar resolución mínima

**3. Sistema de variaciones inteligente (1-2h)**
- Por cada diseño base que funciona, generar automáticamente:
  - Variaciones de color (modo claro/oscuro)
  - Con y sin texto
  - Diferentes composiciones
- Esto multiplica tu catálogo sin multiplicar el esfuerzo de research

**4. Organización de output (1h)**
- Estructura: `output/{date}/{niche}/{design-id}/`
- Cada diseño incluye: imagen original, imagen sin fondo, metadata.json
- Estado inicial de cada diseño: `pending-review`

**Entregable:** `pnpm run generate --niche "funny cat quotes" --products tshirt,mug,poster` genera 10-15 diseños listos para revisión.

---

### SEMANA 4 — Módulo de Validación + Publicación (5-10h)

**Objetivo:** Sistema de revisión manual rápida + publicación automática de lo aprobado.

**1. Sistema de validación CLI (2-3h)**
- Script interactivo que muestra cada diseño pendiente:
  ```
  ┌─────────────────────────────────────────┐
  │  Diseño: funny-cat-001                  │
  │  Nicho: funny cat quotes                │
  │  Producto: tshirt                       │
  │  Archivo: output/.../design.png         │
  │                                         │
  │  [A]probar  [R]echazar  Re[G]enerar     │
  └─────────────────────────────────────────┘
  ```
- Opción alternativa más visual: generar un HTML con grid de thumbnails donde marcas los que apruebas
- Los aprobados se mueven a `approved/`, los rechazados a `rejected/` (para aprender)
- Meta: revisar 25 diseños en ~15-20 minutos

**2. Upload a Printify (1-2h)**
- Subir imagen aprobada: `POST /v1/uploads/images.json`
- Crear producto con el blueprint correcto y print provider
- Mapear diseño a print areas del producto

**3. Generación de metadata SEO con Gemini Pro (1-2h)**
- Para cada producto aprobado, Gemini Pro genera:
  - **Título** (máx 140 chars, keyword-first): "Funny Cat Dad Shirt - Cat Lover Gift - Fathers Day Tshirt"
  - **Descripción** (2000+ chars, keywords naturales, storytelling)
  - **13 tags** (máx 20 chars cada uno, long-tail keywords)
  - **Categoría** Etsy apropiada (taxonomy_id)
- Prompt incluye: nicho, keywords del research, tipo de producto, precios de competencia

**4. Publicar en Etsy vía Printify (1h)**
- `POST /v1/shops/{id}/products/{id}/publish.json`
- Pricing automático: coste Printify + margen configurable (default 50%)
- Redondeo psicológico (19.99, 24.99, etc.)

**5. Pricing strategy (30min)**
- Función que calcula precio basándose en:
  - Coste base del producto en Printify
  - Margen objetivo (configurable por tipo de producto)
  - Precio medio del nicho (del research)
  - Reglas de redondeo

**Entregable:** `pnpm run review` para validar diseños → `pnpm run publish` para publicar los aprobados.

---

### SEMANA 5 — Orquestador y flujo completo (5-8h)

**Objetivo:** Un solo comando que ejecuta todo el flujo, con tu validación en el medio.

**1. Pipeline orquestador (3-4h)**
- Archivo `pipeline.ts` que encadena los módulos en orden:
  1. Research → guarda nichos
  2. Generación → crea diseños en `/pending-review/`
  3. **PAUSA** → te notifica que hay diseños listos para revisar
  4. (Tú revisas manualmente)
  5. Publicación → publica los aprobados
- Configuración en `config.yaml`:
  ```yaml
  research:
    keywords_seed: ["funny cat", "dog mom", "nurse life", "hiking"]
    max_niches: 5
    min_demand_score: 6
  
  generation:
    designs_per_niche: 5
    products: ["tshirt", "mug", "poster"]
    variations_per_design: 3
    style_preference: "minimalist, clean"
  
  publishing:
    margin_percent: 50
    max_publish_per_run: 25
  
  gemini:
    model_text: "gemini-pro"
    model_image: "gemini-2.5-flash-image"
    max_image_requests_per_minute: 8  # margen bajo el límite de 10
  ```

**2. Sistema de estado y tracking (1-2h)**
- SQLite con tablas: `niches`, `designs`, `products`, `stats`
- Evitar duplicados: no re-investigar nichos recientes, no regenerar diseños similares
- Log de cada ejecución del pipeline

**3. Notificaciones (1h)**
- Webhook a Telegram cuando hay diseños listos para revisar
- Mensaje tipo: "🎨 15 nuevos diseños listos para revisar en 3 nichos. Ejecuta `pnpm run review`"

**Entregable:** `pnpm run pipeline` ejecuta research + generación, te avisa, y espera tu aprobación antes de publicar.

---

### SEMANA 6 — Primera tanda real (5-8h)

**Objetivo:** Publicar tus primeros ~25 productos y empezar a recoger datos.

**1. Ejecución real del pipeline (2h)**
- Ejecutar con 3-5 nichos prometedores
- Generar ~40 diseños (esperando aprobar ~25 después de tu filtro)
- Revisar calidad, ajustar prompts donde haga falta

**2. Iteración de calidad (2-3h)**
- Comparar tus diseños con los bestsellers de cada nicho
- Ajustar templates de prompts de Nano Banana
- Probar: mezclar IA + templates predefinidos (ej: tipografía fija + ilustración IA)
- Guardar prompts ganadores como presets reutilizables

**3. Optimización de SEO (1-2h)**
- Revisar los títulos/tags generados por Gemini Pro
- Comparar con los de competidores exitosos en eRank
- Refinar el prompt de SEO si los tags no son óptimos

**4. Setup de automatización recurrente (30min)**
- Cron job semanal: lunes a las 9am ejecuta research automáticamente
- Notificación a Telegram con resumen de nichos encontrados

**Entregable:** ~25 productos vivos en Etsy. Pipeline probado en producción.

---

### SEMANA 7 — Monitoreo y feedback loop (5-8h)

**Objetivo:** Saber qué funciona, duplicar lo bueno, pausar lo malo.

**1. Módulo de tracking (3-4h)**
- Script que consulta stats de Etsy por listing: vistas, favoritos, ventas
- Correlacionar con: nicho, tipo de producto, estilo de diseño
- Guardar histórico en SQLite

**2. Dashboard en terminal (1-2h)**
- `pnpm run stats` muestra:
  ```
  ┌─ Resumen Semanal ──────────────────────────────┐
  │ Productos activos:     25                       │
  │ Vistas totales:        342                      │
  │ Favoritos:             18                       │
  │ Ventas:                3                        │
  │ Revenue:               $67.50                   │
  │                                                 │
  │ Top nicho:   "funny cat quotes" (2 ventas)      │
  │ Peor nicho:  "hiking sunset" (0 vistas)         │
  └─────────────────────────────────────────────────┘
  ```

**3. Feedback loop automático (1-2h)**
- Reglas configurables:
  - Si un nicho tiene >5 ventas en 14 días → flag como "ganador", generar 10 variaciones más
  - Si un nicho tiene <10 vistas en 14 días → flag como "bajo rendimiento"
  - Si un diseño específico vende >3 → expandir a otros productos (mug → hoodie → tote)
- El pipeline usa este feedback para priorizar nichos en la siguiente ejecución

**Entregable:** `pnpm run stats` + feedback loop que ajusta la estrategia automáticamente.

---

### SEMANA 8 — Escalar y estabilizar (5-10h)

**Objetivo:** Pasar a ritmo crucero de ~25 productos/semana y optimizar lo que funciona.

**1. Escalar nichos ganadores (2-3h)**
- Generar más variaciones de diseños que ya vendieron
- Expandir productos: un diseño exitoso en camiseta → probarlo en taza, póster, hoodie
- Explorar sub-nichos relacionados (si "funny cat" vende → probar "funny kitten", "cat mom", "cat dad")

**2. A/B testing básico (2-3h)**
- Para el mismo diseño, crear 2 listings con diferente:
  - Título (keyword order distinto)
  - Precio ($19.99 vs $22.99)
  - Imagen principal (mockup diferente)
- Medir cuál convierte mejor en 7 días
- Desactivar el perdedor

**3. Documentar y refinar (1-2h)**
- README con instrucciones de setup y uso
- Documentar prompts que mejor funcionan
- Lista de lecciones aprendidas para iterar
- Pensar: ¿tiene sentido convertir esto en SaaS?

**Entregable:** Pipeline estable en ritmo crucero. Datos de 50+ productos. Nichos ganadores identificados.

---

## Flujo de validación manual — cómo funciona en detalle

Esto es lo que pasa cada vez que ejecutas el pipeline:

```
1. Ejecutas: pnpm run pipeline

2. El sistema:
   a) Investiga nichos (2-3 min)
   b) Genera 30-40 diseños (10-15 min, con throttle de Gemini)
   c) Te envía notificación a Telegram: "35 diseños listos"

3. Cuando tengas tiempo, ejecutas: pnpm run review

4. Se abre un viewer (CLI o HTML local) con todos los diseños:
   - Ves el diseño
   - Ves sobre qué producto iría (mockup básico)
   - Ves el nicho y keywords asociados
   - Decides: ✓ Aprobar | ✗ Rechazar | ↻ Regenerar

5. Al terminar la revisión (~15-20 min para 30 diseños):
   - Los aprobados se mueven a /approved/
   - Los rechazados se loguean (para mejorar prompts)

6. Ejecutas: pnpm run publish

7. El sistema publica solo los aprobados en Etsy vía Printify.
   Te notifica: "22 productos publicados en Etsy ✓"
```

La idea es que tu intervención manual sea mínima pero estratégica: tú decides qué tiene calidad suficiente para tu tienda.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Rate limits de Gemini free tier | Throttle a 8 req/min. Batch de diseños distribuido en el día |
| Calidad inconsistente de Nano Banana | Tu validación manual filtra lo malo. Iterar prompts. Guardar presets que funcionan |
| Saturación en Etsy de diseños IA | Foco en nichos específicos + curación humana como diferenciador |
| Etsy cambia políticas sobre IA | Seguir su blog oficial. Tener disclosure de IA si lo exigen. Diversificar a otros canales |
| Google cambia free tier de Gemini | 7-8 meses de margen. Si cambia, migrar a Imagen 4 Fast ($0.02/img) como plan B |
| Diseños genéricos que no venden | El feedback loop detecta esto rápido. Pivotar a nichos/estilos que sí convierten |

---

## KPIs para los primeros 3 meses

| Métrica | Mes 1 | Mes 2 | Mes 3 |
|---------|-------|-------|-------|
| Productos publicados | 50-75 | 125-175 | 225-275 |
| Nichos activos | 5-8 | 10-15 | 15-20 |
| Tasa de aprobación (tú) | 50-60% | 65-75% | 75-85% |
| Ventas estimadas | 5-15 | 20-50 | 50-120 |
| Revenue estimado | 50-200€ | 200-600€ | 500-1.500€ |
| Coste operativo | ~55€ | ~55€ | ~55€ |

> A ~25 productos/semana llegas a ~100/mes. El feedback loop te dice dónde doblar la apuesta. El mes 3 es donde se nota la masa crítica si iteras bien.

---

## Próximos pasos para empezar hoy

1. Crear repo: `mkdir etsy-agent && cd etsy-agent && pnpm init`
2. Obtener API key de Gemini en ai.google.dev → Google AI Studio
3. Verificar que tu Etsy API app está activa en developers.etsy.com
4. Sacar tu Printify API token de printify.com/app/account/api
5. Elegir 5 keywords semilla para la primera ejecución de research
6. Testear Nano Banana: generar 3 diseños de prueba y evaluar calidad
