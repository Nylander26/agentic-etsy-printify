import axios, { type AxiosInstance } from "axios";
import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createServer } from "http";
import { env } from "./env.js";

const BASE_URL = "https://openapi.etsy.com/v3";
const TOKEN_FILE = ".etsy-tokens.json";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── Token persistence ─────────────────────────────────────────────────────────

function loadTokens(): TokenStore | null {
  if (!existsSync(TOKEN_FILE)) return null;
  return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as TokenStore;
}

function saveTokens(tokens: TokenStore): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ── OAuth 2.0 flow ────────────────────────────────────────────────────────────

export async function authorize(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = randomBytes(8).toString("hex");

  const scopes = [
    "listings_r", "listings_w",
    "transactions_r", "transactions_w",
    "shops_r", "shops_w",
  ].join("%20");

  const authUrl =
    `https://www.etsy.com/oauth/connect` +
    `?response_type=code` +
    `&client_id=${env.ETSY_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(env.ETSY_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256`;

  console.log("\n🔑 Open this URL in your browser to authorize Etsy:\n");
  console.log(authUrl);
  console.log("\nWaiting for callback on", env.ETSY_REDIRECT_URI, "...\n");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost:3000");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (!code || returnedState !== state) {
        res.end("Invalid callback");
        reject(new Error("Invalid OAuth callback"));
        return;
      }

      res.end("Authorization successful! You can close this tab.");
      server.close();
      resolve(code);
    });

    const port = new URL(env.ETSY_REDIRECT_URI).port || "3000";
    server.listen(Number(port));
  });

  const tokenRes = await axios.post<TokenStore>(
    "https://api.etsy.com/v3/public/oauth/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.ETSY_CLIENT_ID,
      redirect_uri: env.ETSY_REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  saveTokens({
    ...tokenRes.data,
    expires_at: Date.now() + tokenRes.data.expires_at * 1000,
  });

  console.log("✅ Etsy authorized. Tokens saved to", TOKEN_FILE);
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(tokens: TokenStore): Promise<TokenStore> {
  const res = await axios.post<TokenStore>(
    "https://api.etsy.com/v3/public/oauth/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.ETSY_CLIENT_ID,
      refresh_token: tokens.refresh_token,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const fresh: TokenStore = {
    ...res.data,
    expires_at: Date.now() + res.data.expires_at * 1000,
  };
  saveTokens(fresh);
  return fresh;
}

async function getValidToken(): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) throw new Error("No Etsy tokens found. Run: pnpm tsx src/lib/etsy-auth.ts");

  if (Date.now() >= tokens.expires_at - 60_000) {
    tokens = await refreshToken(tokens);
  }

  return tokens.access_token;
}

// ── Rate-limited HTTP client ──────────────────────────────────────────────────

// 10 req/sec → 1 req per 100ms minimum gap
const RATE_GAP_MS = 110;
let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const wait = RATE_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

let _client: AxiosInstance | null = null;

async function client(): Promise<AxiosInstance> {
  const token = await getValidToken();

  if (!_client) {
    _client = axios.create({
      baseURL: BASE_URL,
      headers: {
        "x-api-key": env.ETSY_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    _client.interceptors.request.use(async (config) => {
      await rateLimit();
      // Refresh token on each request (in case it expired mid-session)
      const freshToken = await getValidToken();
      config.headers["Authorization"] = `Bearer ${freshToken}`;
      return config;
    });
  }

  return _client;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getMe(): Promise<{ shop_id: number; user_id: number }> {
  const http = await client();
  const res = await http.get<{ shop_id: number; user_id: number }>("/application/users/me");
  return res.data;
}

export interface EtsyListing {
  listing_id: number;
  title: string;
  state: string;
  views: number;
  num_favorers: number;
  price: { amount: number; divisor: number; currency_code: string };
}

export async function getActiveListings(shopId: number): Promise<EtsyListing[]> {
  const http = await client();
  const res = await http.get<{ results: EtsyListing[] }>(
    `/application/shops/${shopId}/listings/active`
  );
  return res.data.results;
}

export async function searchListings(
  keywords: string,
  limit = 50
): Promise<EtsyListing[]> {
  const http = await client();
  const res = await http.get<{ results: EtsyListing[] }>("/application/listings/active", {
    params: { keywords, limit, sort_on: "score" },
  });
  return res.data.results;
}
