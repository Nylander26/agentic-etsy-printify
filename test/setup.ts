/**
 * Test setup — ensures env-gated modules (anything importing src/lib/env.ts) can be
 * imported without real secrets. Uses existing .env values when present, falls back
 * to dummy credentials otherwise. Tests are pure-function only — they never make
 * network calls, so these placeholders are never used as real keys.
 */
process.env.GEMINI_API_KEY ||= "test-gemini-key";
process.env.PRINTIFY_API_TOKEN ||= "test-printify-token";
