# Keywords de Halloween 2026 — medidas en EverBee

Medido el **2026-08-05**. Fuente: EverBee MCP (`get_keyword`), mercado US.
Volumen = búsquedas/mes. Competencia = listings compitiendo. Score = métrica de EverBee,
sube cuando hay volumen con poca competencia. **Score alto = oportunidad real.**

Ninguna cifra de este documento es una estimación de Gemini. Todas están medidas.

## Fecha límite

La ventana de compra de Halloween **abre el 19 de septiembre** y cierra el 28 de octubre.
Una listing nueva necesita semanas de impresiones antes de rankear, así que **todo lo que
vaya a vender en Halloween tiene que estar publicado antes del 19-sep**. Desde el 5-ago
son ~6 semanas.

Cadencia: **una tanda por semana, keyword distinta cada vez** (`designs_per_niche: 3`).

---

## Ranking

### ✅ PUBLICAR — buena relación volumen/competencia

| # | Keyword | Volumen | Competencia | Score |
|---|---|---:|---:|---:|
| 1 | `halloween book lovers shirt` | 363 | **1.772** | **210** |
| 2 | `halloween shirt for book lovers` | 161 | 1.771 | 90 |
| 3 | `funny halloween pregnant announcement shirt` | 80 | 958 | 80 |
| 4 | `halloween pregnant announcement shirt` | 158 | 1.957 | 80 |
| 5 | `halloween shirt nursing` | 440 | 7.258 | 60 |

### 🟡 DUDOSAS — competencia alta para una tienda sin historial

| Keyword | Volumen | Competencia | Score | Problema |
|---|---:|---:|---:|---|
| `halloween cat mom shirt` | 196 | 6.606 | 30 | 6,6k competidores |
| `shirt for halloween mom black cat` | 95 | 4.306 | 20 | volumen bajo Y 4,3k competidores |
| `couples halloween shirt` | 442 | 14.955 | 30 | 15k competidores |
| `babys first halloween shirt` | 133 | 4.868 | 30 | ver aviso de talla abajo |

### ❌ NO TOCAR

| Keyword | Volumen | Competencia | Motivo |
|---|---:|---:|---|
| `teacher halloween shirt` | 658 | **40.640** | inalcanzable con 0 ventas |
| `nurse halloween shirt` | 412 | 19.380 | usar `halloween shirt nursing` (misma gente, 7,2k) |
| `spooky mama shirt` | 373 | 17.306 | saturadísima, todas sus variantes ~17k |
| `dog mom halloween shirt` | 200 | 9.276 | 9,3k competidores |
| `dog mom halloween comfort colors shirt` | 72 | 1.372 | **Comfort Colors es otra marca de prenda.** Aquí se imprime Bella+Canvas 3001. Rankear ahí trae devoluciones y reseñas malas |
| `pregnant halloween announcement shirt` | **1** | 3.108 | frase que nadie teclea — ver lección 1 |

⚠️ **Aviso de talla:** `babys first halloween shirt` y `halloween first birthday baby shirt`
las busca gente que quiere body o camiseta de bebé. El catálogo sólo tiene Bella+Canvas
3001 (adulto unisex). O se añade un blueprint infantil, o se reenfoca hacia la camiseta
**del padre/madre** a juego. Tal cual está, es tráfico que no puede comprar.

---

## Plan semanal hasta el 19-sep

| Semana | Keyword | Identidad de comprador | Estado |
|---|---|---|---|
| 1 · 5-ago | `funny halloween pregnant announcement shirt` | anuncia embarazo en Halloween | ✅ 5 listings publicadas |
| 2 · 12-ago | `halloween book lovers shirt` | lector, terror literario, biblioteca | 🟡 3 drafts en Printify (6-ago), publicar a Etsy el 12 |
| 3 · 19-ago | `halloween shirt nursing` | enfermería en turno de Halloween | pendiente |
| 4 · 26-ago | `halloween shirt for book lovers` | mismo nicho, segunda consulta | pendiente |
| 5 · 2-sep | `halloween cat mom shirt` | dueña de gato | pendiente |
| 6 · 9-sep | reforzar la que mejor vaya | — | decidir con datos |

**Semana 6 a propósito sin asignar.** Para entonces las tandas 2 y 3 llevarán 3-4 semanas
publicadas y habrá señal de vistas. Mejor meter más diseños donde ya hay movimiento que
abrir un nicho nuevo a ciegas.

**Sólo hay 3 keywords realmente fuertes** (book lovers ×2, nursing) más las 2 de embarazo
ya usadas. El resto del pool está en 5k-15k de competencia. Antes de la semana 5 conviene
medir más temas en EverBee en vez de forzar una keyword floja.

Temas sin medir todavía, candidatos para la próxima sesión: gamer, café, jardinería,
astrología/bruja, true crime, veterinaria, camarero/hostelería, correr/gym, plantas,
profesor de música, padres primerizos, dueños de reptiles.

---

## Dos lecciones mecánicas que cambian el resultado ×6

Ninguna la detecta Gemini, ni el scraper. Sólo se ven midiendo.

**1. El ORDEN de las palabras.**

```
pregnant halloween announcement shirt →   1 búsqueda/mes  (score 0)
halloween pregnant announcement shirt → 158 búsquedas/mes (score 80)
```

Las mismas cuatro palabras. La segunda es lo que la gente teclea de verdad.

**2. La FORMA de la palabra (singular/plural).**

```
halloween book lover  shirt → 388 vol / 10.523 comp / score  40
halloween book lovers shirt → 363 vol /  1.772 comp / score 210
```

Prácticamente el mismo volumen con **seis veces menos competencia**, por una "s".

**Regla: no inventes la frase. Mídela antes de escribirla en `research.keywords_seed`.**

---

## Cómo se usa

1. Poner la keyword de la semana en `config.yaml` → `research.keywords_seed` (lista de 1)
2. `research.auto_discover: false` (ya está)
3. `pnpm pipeline`
4. Revisar y publicar

Discovery sigue sirviendo para **proponer ángulos** (identidades de comprador que no se le
ocurren a uno). Lo que no puede hacer es decir cuál tiene tráfico — ese paso se mide aquí.

Ver también `.claude/notes/halloween-run/handoff.md`.
