# TODO — Publisher / Generator fixes

Pendientes detectados tras la primera tanda de drafts (mayo 2026). Arrancamos mañana.

---

## 1. Verificar stock del proveedor antes de subir (BLOCKER)

**Problema:** se crearon drafts de t-shirts con variantes (talla/color) que el print provider no tiene en stock.

**Estado actual:**
- `src/publisher/blueprint-map.ts` hardcodea `defaultVariants` (IDs de variante) sin comprobar disponibilidad.
- `getCatalogVariants(blueprintId, printProviderId)` ya existe en `src/lib/printify.ts:125` pero **no se usa** en publish.

**A hacer:**
- Antes de `createProduct` (`src/publisher/index.ts:218`), consultar disponibilidad real de cada variante del proveedor.
  - Printify expone `is_available` por variante en `GET /catalog/blueprints/{id}/print_providers/{pid}/variants.json` (verificar el campo exacto; puede requerir endpoint de availability/stock distinto).
- Filtrar `defaultVariants` a solo las disponibles para ese blueprint+provider+color.
- Si una variante hardcodeada ya no está disponible → omitirla y avisar (no fallar todo el draft).
- Si el color/talla solicitado no tiene stock → no subir esa variante (o el producto entero si ninguna queda).

---

## 2. Activar flag de personalización en productos personalizables (BLOCKER)

**Problema:** las imágenes "personalizadas" se suben sin la opción de personalizar activada → no se puede vender un producto personalizable que no se puede personalizar.

**Estado actual:**
- `createProduct` (`src/lib/printify.ts:172`) y `CreateProductInput` (`:152`) no envían nada de personalización.

**A hacer:**
- Añadir soporte de personalización al payload de Printify (campo de personalization / `is_personalization_enabled` + instrucciones — verificar nombre exacto en docs Printify, depende del sales channel Etsy).
- Marcar qué diseños son personalizables (¿flag en `DesignMetadata` o por niche/tipo?) y propagarlo a `draftDesign`.
- Validar que el flag se refleje al publicar en Etsy desde Printify.

---

## 3. Tags/SEO desde el prompt inicial como metadata

**Problema:** los tags no aprovechan el prompt original que generó el diseño; la indexación de búsqueda es pobre.

**Estado actual:**
- `meta.prompt` (prompt final al modelo de imagen) existe en `DesignMetadata` (`src/generator/types.ts:51`) pero **no se pasa** a `generateSEO`.
- `SEO_PROMPT` (`src/publisher/seo.ts:18`) solo usa `niche/concept/style/product/keywords`.

**A hacer:**
- Inyectar `meta.prompt` (y/o keywords derivadas del prompt) en `SEO_PROMPT` para que Gemini genere los 13 tags alineados con la intención de búsqueda real.
- Considerar guardar el prompt/keywords como metadata del producto en Printify si el canal lo soporta.

---

## 4. Workaround imágenes pesadas vía S3 (necesita análisis)

**Problema:** subir imágenes grandes en base64 a Printify es pesado/falla (límite de tamaño, 413).

**Estado actual:**
- `uploadImageBase64` (`src/lib/printify.ts:137`) manda `contents` (base64). Se mitiga con `compressForUpload` (`src/publisher/index.ts:199`) pero no escala.

**A analizar (no implementar aún):**
- Printify `POST /uploads/images.json` también acepta `{ file_name, url }` → subir imagen a S3 (o bucket público temporal) y pasar solo la URL.
- Evaluar: coste/latencia S3, URLs firmadas vs públicas, limpieza posterior, si conviene siempre o solo sobre cierto tamaño.
- Salida del análisis: decisión + helper `uploadImageUrl()` en `printify.ts` si procede.

---

## 5. Diseños dobles → generar front + back por separado

**Problema:** el generador produce **una sola imagen con dos diseños** (ej: ilustración "Lake Vibes" + versión solo-texto "Camping Vibes" lado a lado). No sirve como una sola estampa.

**Decisión:** generar los dos diseños **por separado** → uno para el **frente** y otro para la **espalda** de la franela.

**A hacer:**
- Generator (`src/generator/`): producir 2 archivos distintos (front/back) en vez de 1 lienzo con ambos.
- Printify soporta múltiples `print_areas` por posición — añadir placeholder `back` además de `front` en `draftDesign` (`src/publisher/index.ts:229`, `printPosition` en `blueprint-map.ts`).
- Modelar front/back en `DesignMetadata.files` y en el blueprint map (posiciones soportadas por blueprint).

---

## 6. No recortar imágenes de franela como si fueran de taza (BLOCKER)

**Problema:** una imagen con formato/aspecto de taza (wraparound ancho, texto cortado en los bordes — ej. "Grillfather") se está colocando en una t-shirt, donde queda recortada/incompleta. Las estampas de franela no se pueden cropear como las de taza.

**Estado actual:**
- `resolveSourceImage` (`src/publisher/index.ts:142`) y `resizeForPrintify` (`src/generator/post-processor.ts`) usan dimensiones por producto: tshirt `4500×5400` vs mug `2700×1050` wrap (`PRINTIFY_DIMENSIONS` en `src/generator/types.ts:65`).
- El fan-out (`src/publisher/index.ts:285`) reusa la **misma** imagen base para tshirt/mug/poster → un diseño pensado/generado en formato taza termina recortado al forzarlo al aspecto de franela (o viceversa).

**A hacer:**
- No reusar una imagen de aspecto-taza para franela: el resize a tshirt debe **encajar completa** (contain/fit, sin recorte) o regenerar/usar una variante con el aspecto correcto.
- Garantizar que cada producto reciba una imagen con el aspect ratio correcto antes de subir; si la fuente no encaja sin recorte, no degradar la estampa.
- Revisar `resizeForPrintify` para t-shirt: `fit: contain` (con fondo transparente) en vez de cover/crop.
- Relacionado con #5 (front/back) — separar artefactos por producto/posición.

---

## 7. Shipping: el más económico, USA-only

**Problema:** solo vendo a clientes de USA → el shipping debe ser el doméstico US más barato. Hoy no se gestiona shipping en absoluto.

**Estado actual:**
- No hay manejo de shipping ni de profiles en el código (ninguna referencia en `src/lib/printify.ts` ni en publisher).
- Los print providers están hardcodeados en `blueprint-map.ts` (ej. tshirt = Monster Digital `29`); su `location` está en `PrintProvider` (`src/lib/printify.ts:77`) pero no se filtra por país.

**A hacer:**
- Preferir print providers **ubicados en US** (`location.country === "US"`) → shipping doméstico más barato y entrega más rápida.
- Al crear el draft, asegurar que el shipping profile / método sea el económico doméstico US (verificar cómo lo expone Printify para el canal Etsy: profile por defecto vs. configurable).
- Posiblemente cruzar con #1 (stock): elegir provider US **que además** tenga stock de la variante.
- Atar a `market` en `config.yaml` (default US) para que sea coherente con el resto del pipeline.

---

## 8. Evitar drafts duplicados en Printify (BLOCKER)

**Problema:** hay ~149 productos subidos y muchos son duplicados. Falta validación que impida cargar drafts repetidos a Printify.

**Estado actual:**
- `alreadyDraftedFor` (`src/publisher/index.ts:129`) **solo** evita redraftear el mismo diseño+producto, y únicamente leyendo el array `drafts` del `metadata.json` local de ESE diseño.
- No hay dedup global entre diseños distintos, ni chequeo contra lo que ya existe en Printify. Re-correr publish sobre `approved/` o regenerar metadata pierde ese estado y vuelve a subir.
- CLAUDE.md menciona tablas SQLite (`products`) para prevenir duplicados, pero no está implementado en el publisher.

**A hacer:**
- Antes de `createProduct` (`src/publisher/index.ts:218`), comprobar si ya existe un draft equivalente:
  - Persistir un registro global de `(designId, product, printifyProductId)` — SQLite (`products`) o un índice JSON central, no solo el meta por diseño.
  - Opcional/robusto: listar productos existentes en Printify (`GET /shops/{id}/products.json`) y deduplicar por título o por hash de la imagen subida.
- Definir la clave de unicidad: probablemente `designId + product (+ posición front/back)`.
- Limpieza one-off: identificar y borrar los duplicados ya subidos de los 149 (script aparte; confirmar con el usuario antes de borrar nada en Printify).

---

_Nota: nada de esto se implementa hoy — solo backlog para mañana._
