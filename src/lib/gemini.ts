import { GoogleGenerativeAI, type GenerateContentResult } from "@google/generative-ai";
import { env } from "./env.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// ── Text client (Gemini Pro) ──────────────────────────────────────────────────

const textModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

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

// ── Image client (gemini-2.5-flash — "Nano Banana") ──────────────────────────

const imageModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp-image-generation" });

// Token bucket: 8 req/min (free tier cap is 10, we stay under)
const IMAGE_RATE_LIMIT = 8;
const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

async function waitForImageSlot(): Promise<void> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Drop timestamps outside the window
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
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  await waitForImageSlot();

  const result = await imageModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      // @ts-expect-error — responseModalities not yet in SDK types
      responseModalities: ["IMAGE"],
    },
  });

  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      };
    }
  }

  throw new Error("No image returned from Gemini");
}
