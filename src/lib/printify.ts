import axios, { type AxiosInstance } from "axios";
import { env } from "./env.js";

const BASE_URL = "https://api.printify.com/v1";

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${env.PRINTIFY_API_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrintifyShop {
  id: string;
  title: string;
  sales_channel: string;
}

export interface Blueprint {
  id: number;
  title: string;
  brand: string;
  model: string;
  description: string;
}

export interface PrintProvider {
  id: number;
  title: string;
  location: { country: string; region: string };
}

export interface UploadedImage {
  id: string;
  file_name: string;
  preview_url: string;
}

export interface PrintifyProduct {
  id: string;
  title: string;
  description: string;
  blueprint_id: number;
  print_provider_id: number;
}

// ── Shop ──────────────────────────────────────────────────────────────────────

export async function getShops(): Promise<PrintifyShop[]> {
  const res = await http.get<PrintifyShop[]>("/shops.json");
  return res.data;
}

// ── Blueprints (product catalog) ──────────────────────────────────────────────

export async function getBlueprints(): Promise<Blueprint[]> {
  const res = await http.get<Blueprint[]>("/catalog/blueprints.json");
  return res.data;
}

export async function getPrintProviders(blueprintId: number): Promise<PrintProvider[]> {
  const res = await http.get<PrintProvider[]>(
    `/catalog/blueprints/${blueprintId}/print_providers.json`
  );
  return res.data;
}

export interface CatalogVariant {
  id: number;
  title: string; // e.g. "Black / S"
  options: { color?: string; size?: string; [k: string]: string | undefined };
  placeholders?: Array<{ position: string; height: number; width: number }>;
}

export async function getCatalogVariants(
  blueprintId: number,
  printProviderId: number
): Promise<CatalogVariant[]> {
  const res = await http.get<{ variants: CatalogVariant[] }>(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`
  );
  return res.data.variants;
}

// ── Image upload ──────────────────────────────────────────────────────────────

export async function uploadImageBase64(
  fileName: string,
  base64: string,
  mimeType = "image/png"
): Promise<UploadedImage> {
  const res = await http.post<UploadedImage>("/uploads/images.json", {
    file_name: fileName,
    contents: base64,
    media_type: mimeType,
  });
  return res.data;
}

// ── Products ──────────────────────────────────────────────────────────────────

export interface CreateProductInput {
  shopId: string;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variants: Array<{
    id: number;
    price: number; // in cents
    is_enabled: boolean;
  }>;
  printAreas: Array<{
    variant_ids: number[];
    placeholders: Array<{
      position: string;
      images: Array<{ id: string; x: number; y: number; scale: number; angle: number }>;
    }>;
  }>;
}

export async function createProduct(input: CreateProductInput): Promise<PrintifyProduct> {
  const res = await http.post<PrintifyProduct>(
    `/shops/${input.shopId}/products.json`,
    {
      title: input.title,
      description: input.description,
      blueprint_id: input.blueprintId,
      print_provider_id: input.printProviderId,
      variants: input.variants,
      print_areas: input.printAreas,
    }
  );
  return res.data;
}

export interface ProductMockup {
  src: string;
  variant_ids: number[];
  position: string;
  is_default: boolean;
  is_selected_for_publishing: boolean;
}

export interface FullProduct extends PrintifyProduct {
  images: ProductMockup[];
}

export async function getProduct(shopId: string, productId: string): Promise<FullProduct> {
  const res = await http.get<FullProduct>(`/shops/${shopId}/products/${productId}.json`);
  return res.data;
}

/**
 * Selects which auto-generated mockups Printify will push to the sales channel.
 * Printify keys mockups by their `src` URL — pass the URLs to enable for publishing.
 */
export async function updateMockupSelection(
  shopId: string,
  productId: string,
  selectedSrcs: string[]
): Promise<void> {
  const selectedSet = new Set(selectedSrcs);
  const product = await getProduct(shopId, productId);

  const images = product.images.map((img) => ({
    ...img,
    is_selected_for_publishing: selectedSet.has(img.src),
  }));

  await http.put(`/shops/${shopId}/products/${productId}.json`, { images });
}

// Note: Printify's POST /products/{id}/publish.json triggers sales-channel publishing.
// We intentionally don't expose it — productos quedan en DRAFT y se publican manualmente
// desde el dashboard de Printify (botón "Publish to Etsy") o vía el etsy-pack generado.
