/**
 * Product/keyword coherence guard.
 *
 * A research keyword may name a product type (e.g. "Independence Day Mug").
 * If that product isn't in config.generation.products, generating designs for
 * it is incoherent — we'd make a t-shirt for a keyword that literally says "Mug",
 * and the published listing's SEO would fight the artwork.
 *
 * Rule: reject a keyword ONLY if it names a product type we don't produce.
 * Product-agnostic keywords ("Funny Dad BBQ") are always fine — generation
 * appends the configured product itself.
 */
import type { ProductType } from "../generator/types.js";

// Product type → the nouns that signal it in an Etsy keyword.
const PRODUCT_NOUNS: Record<ProductType, string[]> = {
  tshirt: ["shirt", "tee", "t-shirt", "tshirt", "tees", "shirts"],
  mug: ["mug", "mugs", "cup", "tumbler"],
  poster: ["poster", "posters", "print", "prints", "wall art"],
};

// Reverse lookup: noun → product type
const NOUN_TO_PRODUCT: Array<{ noun: string; product: ProductType }> = Object.entries(
  PRODUCT_NOUNS
).flatMap(([product, nouns]) =>
  nouns.map((noun) => ({ noun, product: product as ProductType }))
);

/**
 * Returns the product types named in a keyword (may be empty).
 * Matches whole words only (so "tee" doesn't match "teenager").
 */
export function productsNamedIn(keyword: string): ProductType[] {
  const lower = ` ${keyword.toLowerCase()} `;
  const found = new Set<ProductType>();
  for (const { noun, product } of NOUN_TO_PRODUCT) {
    // word-boundary match; handles multi-word nouns like "wall art"
    const re = new RegExp(`(^|[^a-z])${noun.replace(/[-]/g, "[- ]")}([^a-z]|$)`, "i");
    if (re.test(lower)) found.add(product);
  }
  return [...found];
}

/**
 * True if the keyword is coherent with the configured products:
 *   - names no product → OK (product-agnostic)
 *   - names only configured products → OK
 *   - names any non-configured product → NOT coherent
 */
export function keywordMatchesProducts(
  keyword: string,
  configured: ProductType[]
): boolean {
  const named = productsNamedIn(keyword);
  if (named.length === 0) return true;
  return named.every((p) => configured.includes(p));
}

/** Reason string for logging a rejected keyword (null if coherent). */
export function coherenceRejectReason(
  keyword: string,
  configured: ProductType[]
): string | null {
  const named = productsNamedIn(keyword);
  const offending = named.filter((p) => !configured.includes(p));
  if (offending.length === 0) return null;
  return `keyword nombra producto no configurado (${offending.join(", ")}); products=${configured.join(", ")}`;
}

/** Human-readable list of product nouns we DO produce — for the discovery prompt. */
export function allowedProductNouns(configured: ProductType[]): string[] {
  return configured.flatMap((p) => PRODUCT_NOUNS[p]);
}

/** Human-readable list of product nouns to AVOID — for the discovery prompt. */
export function forbiddenProductNouns(configured: ProductType[]): string[] {
  return (Object.keys(PRODUCT_NOUNS) as ProductType[])
    .filter((p) => !configured.includes(p))
    .flatMap((p) => PRODUCT_NOUNS[p]);
}
