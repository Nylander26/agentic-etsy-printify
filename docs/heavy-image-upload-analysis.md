# Análisis #4 — Subida de imágenes pesadas a Printify (workaround S3/URL)

_Fecha: 2026-05-21. Análisis, no implementación._

## Problema

`uploadImageBase64` (`src/lib/printify.ts`) envía la imagen como base64 en el body del POST
`/uploads/images.json`. base64 infla ~4/3, y el body de Printify tiene un límite práctico
(~10 MB históricamente). Hoy se mitiga con `compressForUpload` (`src/generator/post-processor.ts`),
que cuantiza la paleta (256→128→64 colores, **lossy**) cuando la imagen supera `publishing.max_upload_mb`.
Con upscaler activado o arte muy detallado, eso degrada la calidad o arriesga HTTP 413.

## Hallazgo empírico (verificado contra la API real, 2026-05-21)

Printify `POST /uploads/images.json` acepta **dos formas**:
- `{ file_name, contents (base64), media_type }` — la que usamos hoy.
- `{ file_name, url }` — **Printify descarga la imagen desde la URL**. Verificado:
  - ✅ `url: https://placehold.co/1000x1000.png` → devuelve `UploadedImage { id, width, height, size, preview_url }`.
  - ❌ `url: raw.githubusercontent.com/...` → `code 10300 "Operation failed"`.

**Conclusión:** la URL debe ser una **descarga directa** de la imagen (content-type imagen,
sin redirects ni hotlink-protection). Las URLs **presigned de S3** cumplen → sirven.
Esto elimina por completo el límite de body base64 y la cuantización lossy.

## Opciones de hosting

| Opción | Costo | Notas |
|---|---|---|
| **S3 + presigned URL** | bajo (storage + egress) | Estándar, presigned ya es URL directa. Egress se paga. |
| **Cloudflare R2** | storage barato, **egress gratis** | S3-compatible (mismo SDK). Recomendado si el costo de egress molesta. |
| Bucket público temporal | bajo | Más simple pero expone la imagen sin expiración salvo lifecycle rules. |

Printify descarga la imagen **una sola vez** al subirla; después la imagen vive en su media
library. Por lo tanto el objeto en S3/R2 es **efímero**: se puede borrar (o expirar vía
lifecycle/TTL) tras una subida exitosa.

## Diseño propuesto (cuando se implemente)

1. `src/lib/printify.ts`: añadir
   ```ts
   export async function uploadImageUrl(fileName: string, url: string): Promise<UploadedImage> {
     const res = await http.post<UploadedImage>("/uploads/images.json", { file_name: fileName, url });
     return res.data;
   }
   ```
2. `src/lib/storage.ts` (nuevo): `putTempObject(buffer, key) → { url, cleanup() }` con presigned URL
   (S3 o R2 vía `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`).
3. `src/publisher/index.ts` `draftDesign`: decidir por tamaño —
   ```ts
   const base64Bytes = Math.ceil(buf.length / 3) * 4;
   if (base64Bytes > UPLOAD_URL_THRESHOLD) {        // p.ej. > 10 MB
     const { url, cleanup } = await putTempObject(buf, `${meta.id}-${product}.png`);
     uploaded = await uploadImageUrl(name, url);
     await cleanup();                                // Printify ya la copió
   } else {
     uploaded = await uploadImageBase64(name, buf.toString("base64"));
   }
   ```
   Así NO se cuantiza nunca por límite de body: lossless siempre que la imagen sea pesada.
4. Config: `publishing.upload_via_url: bool`, `publishing.upload_url_threshold_mb`, credenciales
   S3/R2 en `.env` (`S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` o R2 equiv.).

## Recomendación

- Implementar `uploadImageUrl` + hosting **R2** (egress gratis) con objeto efímero (borrar tras subir).
- Aplicarlo **solo sobre umbral** (p.ej. >8 MB base64); por debajo seguir con base64 (cero infra).
- Quita la necesidad de `compressForUpload` lossy en imágenes pesadas (mantenerla solo como
  red de seguridad si falta config de bucket).

## Costo / riesgo

- Costo: storage mínimo + (egress 0 en R2). Una subida = una descarga de Printify.
- Riesgo: si el bucket/credenciales fallan, fallback a base64 (degradar con gracia, no romper el run).
- Seguridad: presigned URL de vida corta (minutos) o borrado inmediato post-upload.
