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

/**
 * Calls Gemini in strict JSON mode and parses the response.
 *
 * `responseMimeType: application/json` forces the model to emit a valid JSON
 * literal (no markdown fences, no stray prose). The model still occasionally
 * emits a malformed string (unescaped quotes inside long descriptions), so we
 * retry once before giving up.
 */
export async function generateJSON<T>(prompt: string): Promise<T> {
  const jsonModel = genAI.getGenerativeModel({
    model: cfg.gemini.model_text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { responseMimeType: "application/json" } as any,
  });

  const attempt = async (): Promise<T> => {
    const result = await jsonModel.generateContent(prompt);
    const raw = result.response.text();
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned) as T;
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof SyntaxError) {
      // One retry on JSON parse failure
      return await attempt();
    }
    throw err;
  }
}

// ── Vision client (multimodal, JSON-mode) ────────────────────────────────────

// Vision token bucket — separate from image-generation. Free tier Gemini 1.5
// Pro is 50 RPD / 2 RPM. Stay below the per-minute cap with a 5-slot window.
const VISION_RATE_LIMIT = 5;
const VISION_WINDOW_MS = 60_000;
const visionTimestamps: number[] = [];

async function waitForVisionSlot(): Promise<void> {
  const now = Date.now();
  const cutoff = now - VISION_WINDOW_MS;
  while (visionTimestamps.length > 0 && (visionTimestamps[0] ?? 0) < cutoff) {
    visionTimestamps.shift();
  }
  if (visionTimestamps.length >= VISION_RATE_LIMIT) {
    const oldest = visionTimestamps[0] ?? now;
    const waitMs = VISION_WINDOW_MS - (now - oldest) + 100;
    await new Promise((r) => setTimeout(r, waitMs));
    return waitForVisionSlot();
  }
  visionTimestamps.push(Date.now());
}

/**
 * Sends a base64-encoded image plus a text prompt to a Gemini vision model
 * (default from `validator.vision_model` in config) and parses the response as
 * strict JSON. Used by the design validator agent.
 */
export async function analyzeImage<T>(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<T> {
  const visionModelName = cfg.validator.vision_model;
  const visionModel = genAI.getGenerativeModel({
    model: visionModelName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 } as any,
  });

  const attempt = async (): Promise<T> => {
    await waitForVisionSlot();
    const result = await visionModel.generateContent([
      { text: prompt },
      { inlineData: { data: imageBase64, mimeType } },
    ]);
    const raw = result.response.text();
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned) as T;
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof SyntaxError) return await attempt();
    throw err;
  }
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

export interface ImageGenOptions {
  // Gemini imageConfig.aspectRatio, e.g. "1:1", "4:5", "21:9". Sets the NATIVE shape so the
  // print resize doesn't pad (mug = wide, poster = portrait). Omitted → model default (square).
  aspectRatio?: string;
  // Override the configured native resolution ("512" | "1K" | "2K" | "4K").
  imageSize?: string;
}

// responseModalities + imageConfig are not yet in the SDK GenerationConfig types.
// imageConfig.imageSize controls native output resolution (Nano Banana 2: 512/1K/2K/4K) —
// real detail from the model, not interpolation; aspectRatio sets the native shape.
function imageRequest(prompt: string, opts?: ImageGenOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageConfig: any = { imageSize: opts?.imageSize ?? cfg.gemini.image_size };
  if (opts?.aspectRatio) imageConfig.aspectRatio = opts.aspectRatio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generationConfig: any = { responseModalities: ["IMAGE"], imageConfig };
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
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

export async function generateImage(
  prompt: string,
  opts?: ImageGenOptions
): Promise<GeneratedImage> {
  await waitForImageSlot();
  const result = await imageModel.generateContent(imageRequest(prompt, opts));
  const img = extractImage(result, cfg.gemini.model_image);
  if (img) return img;
  throw new Error("No image returned (model returned text-only response)");
}
