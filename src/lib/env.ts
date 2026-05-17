import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  PRINTIFY_API_TOKEN: z.string().min(1),
  EVERBEE_API_KEY: z.string().optional(),  // Etsy marketplace stats provider (dev.everbee.io)
  EVERBEE_API_BASE: z.string().optional(), // override default base URL when API ships
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export const env = schema.parse(process.env);
