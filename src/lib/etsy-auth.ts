/**
 * Ejecutar una sola vez para autorizar Etsy:
 *   pnpm tsx src/lib/etsy-auth.ts
 *
 * Abrirá una URL en consola → ábrela en el browser → callback automático.
 * Guarda tokens en .etsy-tokens.json (añadido al .gitignore).
 */
import { authorize } from "./etsy.js";

await authorize();
