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

export async function publishProduct(
  shopId: string,
  productId: string
): Promise<void> {
  await http.post(`/shops/${shopId}/products/${productId}/publish.json`, {
    title: true,
    description: true,
    images: true,
    variants: true,
    tags: true,
    keyFeatures: true,
    shipping_template: true,
  });
}
