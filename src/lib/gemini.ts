import { GoogleGenerativeAI, type GenerateContentResult } from "@google/generative-ai";
import { env } from "./env.js";
import { getConfig } from "./config.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
const cfg = getConfig();

// ── Text client ───────────────────────────────────────────────────────────────

const textModel = genAI.getGenerativeModel({ model: cfg.gemini.model_text });

export async function generateText(prompt: string): Promise<string> {
  const result: GenerateContentResult = await textModel.generateContent(prompt);
  return result.response.text();
}

export async function generateJSON<T>(prompt: string): Promise<T> {
  const raw = await generateText(
    `${prompt}\n\nRespond with valid JSON only. No markdown, no explanation.`
  );
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

// ── Image client ──────────────────────────────────────────────────────────────

// Single model — el del config (Nano Banana 2). Si falla, skip.
// Pro genera con cortes/errores frecuentes, así que sin fallback automático.
// SDK RequestOptions.timeout aborta el fetch subyacente — sin requests colgando.
const IMAGE_TIMEOUT_MS = 240_000;

const imageModel = genAI.getGenerativeModel(
  { model: cfg.gemini.model_image },
  { timeout: IMAGE_TIMEOUT_MS }
);

// Token bucket: 8 req/min (free tier cap is 10, we stay under)
const IMAGE_RATE_LIMIT = 8;
const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

async function waitForImageSlot(): Promise<void> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (requestTimestamps.length > 0 && (requestTimestamps[0] ?? 0) < cutoff) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= IMAGE_RATE_LIMIT) {
    const oldest = requestTimestamps[0] ?? now;
    const waitMs = WINDOW_MS - (now - oldest) + 100;
    await new Promise((r) => setTimeout(r, waitMs));
    return waitForImageSlot();
  }
  requestTimestamps.push(Date.now());
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  model: string;
}

// responseModalities is not yet in the SDK GenerationConfig types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const imageGenConfig: any = { responseModalities: ["IMAGE"] };

function imageRequest(prompt: string) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: imageGenConfig,
  };
}

function extractImage(result: GenerateContentResult, model: string): GeneratedImage | null {
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData) {
      return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType, model };
    }
  }
  return null;
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  await waitForImageSlot();
  const result = await imageModel.generateContent(imageRequest(prompt));
  const img = extractImage(result, cfg.gemini.model_image);
  if (img) return img;
  throw new Error("No image returned (model returned text-only response)");
}
