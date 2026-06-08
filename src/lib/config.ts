import { readFileSync } from "fs";
import { parse } from "yaml";
import { z } from "zod";

const schema = z.object({
  market: z
    .object({
      country: z.string().length(2).default("US"),
      currency: z.string().length(3).default("USD"),
      language: z.string().length(2).default("en"),
      audience: z.string().default("US Etsy buyers"),
    })
    .default({}),
  research: z.object({
    auto_discover: z.boolean().default(false),
    discovery_window_days: z.number().int().min(1).max(180).default(7),
    discovery_candidates: z.number().int().min(5).max(100).default(25),
    keywords_seed: z.array(z.string()).default([]),
    max_niches: z.number().int().min(1).max(20),
    min_demand_score: z.number().min(1).max(10),
    geo: z.string().default("US"),
  }),
  generation: z.object({
    designs_per_niche: z.number().int().min(1).max(20),
    products: z.array(z.enum(["tshirt", "mug", "poster"])),
    variations_per_design: z.number().int().default(3),
    style_preference: z.string().default("minimalist, clean"),
    remove_background: z.boolean().default(false),
    tshirt_back_design: z.boolean().default(false),
  }),
  validator: z
    .object({
      max_regenerations: z.number().int().min(0).max(5).default(2),
      approval_threshold: z.number().min(1).max(10).default(6.5),
      borderline_threshold: z.number().min(1).max(10).default(5.0),
      vision_model: z.string().default("gemini-1.5-pro"),
      enforce_market_fit: z.boolean().default(true),
      auto_approve_passing: z.boolean().default(true),
      auto_regenerate: z.boolean().default(true),
    })
    .default({}),
  publishing: z.object({
    // Printify shop id to publish into. If unset, we prefer the Etsy-linked shop and
    // only fall back to the first shop. Pin this so the pipeline never drafts into the
    // wrong store (e.g. a custom_integration shop) when the account has several.
    shop_id: z.number().int().optional(),
    margin_percent: z.number().min(10).max(80).default(50), // legacy; pricing now uses target_net_margin
    // Net-margin pricing: retail = (garment + shipping + Etsy fixed fee) / (1 - etsy_rate - target_net_margin).
    // target_net_margin is profit AFTER garment cost, absorbed shipping (free_shipping) and Etsy fees.
    free_shipping: z.boolean().default(true),
    shipping_cost_usd: z.number().min(0).max(50).default(4.75),
    etsy_offsite_ads: z.boolean().default(true),       // bake the off-site ads fee into price
    etsy_offsite_ads_rate: z.number().min(0).max(0.2).default(0.12), // 12% <$10k/yr, 15% above
    target_net_margin: z.number().min(0.0).max(0.6).default(0.16),
    max_publish_per_run: z.number().int().min(1).max(100).default(25),
    // Max base64 upload body to Printify (MB). Above this, the image is palette-quantized
    // to fit (lossy). Printify's POST body limit is ~10MB; bump if you see needless
    // quantization, lower if you see HTTP 413.
    max_upload_mb: z.number().min(1).max(90).default(9),
    // If set, each approved design is also drafted on these extra product types,
    // re-using the same source artwork resized to each target's print dimensions.
    fan_out_products: z.array(z.enum(["tshirt", "mug", "poster"])).optional(),
    personalization: z
      .object({
        enabled: z.boolean().default(true),
        instructions: z
          .string()
          .default("Add the exact name/text you want printed. Message us for special requests."),
        buyer_response_limit: z.number().int().min(1).max(1024).default(50),
        auto_detect: z.boolean().default(true),
      })
      .default({}),
    prefer_economy_shipping: z.boolean().default(true),
  }),
  gemini: z.object({
    model_text: z.string().default("gemini-2.0-flash"),
    model_image: z.string().default("gemini-2.0-flash-exp-image-generation"),
    image_size: z.enum(["512", "1K", "2K", "4K"]).default("2K"),
    max_image_requests_per_minute: z.number().int().min(1).max(10).default(8),
  }),
  upscaler: z
    .object({
      enabled: z.boolean().default(false),
      binary_path: z.string().default(""),
      model: z.string().default("realesrgan-x4plus"),
      scale: z.number().int().min(2).max(4).default(4),
    })
    .default({}),
  pipeline: z.object({
    notify_telegram: z.boolean().default(true),
    auto_publish: z.boolean().default(false),
  }),
  // Post-publication feedback loop thresholds. Sales come from Printify orders
  // (the only real, programmatic sales signal — Etsy's API is unavailable).
  monitor: z
    .object({
      winner_min_units: z.number().int().min(1).default(3), // >= units sold → winner, scale it
      loser_window_days: z.number().int().min(1).default(21), // no sales after this age → underperformer
    })
    .default({}),
  // Asset retention. Generated images under output/ are regenerable intermediates (the
  // published artwork lives on Printify). Each pipeline run prunes old assets to the last
  // `keep_runs` runs (a run = a date). Set enabled=false to keep everything.
  cleanup: z
    .object({
      enabled: z.boolean().default(true),
      keep_runs: z.number().int().min(1).default(3),
    })
    .default({}),
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
