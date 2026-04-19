import { readFileSync } from "fs";
import { parse } from "yaml";
import { z } from "zod";

const schema = z.object({
  research: z.object({
    keywords_seed: z.array(z.string()),
    max_niches: z.number().int().min(1).max(20),
    min_demand_score: z.number().min(1).max(10),
    listings_per_keyword: z.number().int().min(10).max(100).default(50),
  }),
  generation: z.object({
    designs_per_niche: z.number().int().min(1).max(20),
    products: z.array(z.enum(["tshirt", "mug", "poster"])),
    variations_per_design: z.number().int().default(3),
    style_preference: z.string().default("minimalist, clean"),
  }),
  publishing: z.object({
    margin_percent: z.number().min(10).max(80).default(50),
    max_publish_per_run: z.number().int().min(1).max(100).default(25),
  }),
  gemini: z.object({
    model_text: z.string().default("gemini-1.5-pro"),
    model_image: z.string().default("gemini-2.0-flash-exp-image-generation"),
    max_image_requests_per_minute: z.number().int().min(1).max(10).default(8),
  }),
  pipeline: z.object({
    notify_telegram: z.boolean().default(true),
    auto_publish: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof schema>;

function loadConfig(): Config {
  try {
    const raw = readFileSync("config.yaml", "utf-8");
    const parsed = parse(raw) as unknown;
    return schema.parse(parsed);
  } catch (err) {
    throw new Error(`Failed to load config.yaml: ${err instanceof Error ? err.message : err}`);
  }
}

// Singleton — loaded once per process
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}
