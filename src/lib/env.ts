import "dotenv/config";
import { z } from "zod";

// Helper: treat empty string env vars as undefined (Zod's optional() accepts
// "" as a valid string, but for credentials we want explicit "not configured")
const optionalNonEmpty = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  PRINTIFY_API_TOKEN: z.string().min(1),
  APIFY_TOKEN: optionalNonEmpty,          // Apify token — scraper-as-a-service for Etsy SERP
  APIFY_ETSY_ACTOR_ID: optionalNonEmpty,  // override the public Etsy search actor (see plan)
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_CHAT_ID: optionalNonEmpty,
  UPSCALER_BINARY_PATH: optionalNonEmpty,  // local realesrgan-ncnn-vulkan .exe — kept out of git
});

export const env = schema.parse(process.env);
