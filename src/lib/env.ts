import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  ETSY_CLIENT_ID: z.string().min(1),
  ETSY_CLIENT_SECRET: z.string().min(1),
  ETSY_REDIRECT_URI: z.string().url().default("http://localhost:3000/oauth/callback"),
  PRINTIFY_API_TOKEN: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export const env = schema.parse(process.env);
