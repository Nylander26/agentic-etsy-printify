# TODO — Publisher / Generator

Implementado #1, #2, #3, #5, #6, #7, #8 y entregado el análisis #4 (`docs/heavy-image-upload-analysis.md`). Ver historial de git para el detalle.

## Pendiente

### Eliminar los drafts duplicados existentes en Printify

La **prevención** ya está hecha (índice central `output/.draft-index.json` + `pnpm dedup`). Falta la **limpieza one-off** de los duplicados ya subidos.

- `pnpm dedup` reporta los duplicados (read-only).
- `pnpm dedup --apply` los borra (conserva el más antiguo por título).
- **Limitación:** el dedup solo detecta duplicados por **título exacto**; los que tienen títulos SEO distintos (mismo diseño, otro copy) no se detectan automáticamente. Decidir si basta con el borrado por título o hace falta otra estrategia (p. ej. hash de imagen) para los ~118 huérfanos sin entrada en el índice.
- ⚠️ Borra en la tienda real de Printify — revisar el reporte antes de correr `--apply`.
