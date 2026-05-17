import googleTrends from "google-trends-api";
import type { NicheData } from "./types.js";

// google-trends-api has no published types
type TrendsModule = {
  interestOverTime(opts: { keyword: string; startTime?: Date; geo?: string }): Promise<string>;
  relatedQueries(opts: { keyword: string; geo?: string }): Promise<string>;
  relatedTopics(opts: { keyword: string; geo?: string }): Promise<string>;
};
const trends = googleTrends as unknown as TrendsModule;

// Throttle: Google's internal endpoint rate-limits aggressively per IP.
// 6s gap entre peticiones — conservador para evitar bans temporales.
const GAP_MS = 6000;
let lastCall = 0;
async function throttle(): Promise<void> {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

interface TimelinePoint {
  time: string;
  value: number[];
}

interface InterestResponse {
  default: { timelineData: TimelinePoint[] };
}

interface RankedKeyword {
  query?: string;
  topic?: { title: string; type: string };
  value: number;
}

interface RankedList {
  rankedKeyword: RankedKeyword[];
}

interface RelatedResponse {
  default: { rankedList: RankedList[] };
}

function parseJSON<T>(raw: string, ctx: string): T | null {
  // google-trends-api sometimes returns an HTML 429 page when rate-limited
  if (!raw || raw.trim().startsWith("<")) {
    console.warn(`  ⚠️  Trends rate-limited or empty (${ctx})`);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function classifyTrend(points: TimelinePoint[]): "rising" | "stable" | "declining" {
  if (points.length < 4) return "stable";
  const half = Math.floor(points.length / 2);
  const avg = (arr: TimelinePoint[]) =>
    arr.reduce((s, p) => s + (p.value[0] ?? 0), 0) / arr.length;
  const first = avg(points.slice(0, half));
  const last = avg(points.slice(half));
  const delta = last - first;
  if (delta > 5) return "rising";
  if (delta < -5) return "declining";
  return "stable";
}

export async function searchNiche(keyword: string, geo = "US"): Promise<NicheData> {
  // 12 months of weekly data
  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - 12);

  await throttle();
  const interestRaw = await trends.interestOverTime({ keyword, startTime, geo });
  const interest = parseJSON<InterestResponse>(interestRaw, "interestOverTime");

  await throttle();
  const queriesRaw = await trends
    .relatedQueries({ keyword, geo })
    .catch(() => "");
  const queries = parseJSON<RelatedResponse>(queriesRaw, "relatedQueries");

  await throttle();
  const topicsRaw = await trends
    .relatedTopics({ keyword, geo })
    .catch(() => "");
  const topics = parseJSON<RelatedResponse>(topicsRaw, "relatedTopics");

  const timeline = interest?.default.timelineData ?? [];
  const values = timeline.map((p) => p.value[0] ?? 0);
  const avgInterest = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
  const peakInterest = values.length ? Math.max(...values) : 0;
  const trend = classifyTrend(timeline);

  const ranked = queries?.default.rankedList ?? [];
  const topQueries = (ranked[0]?.rankedKeyword ?? [])
    .map((r) => r.query)
    .filter((q): q is string => !!q)
    .slice(0, 15);
  const risingQueries = (ranked[1]?.rankedKeyword ?? [])
    .map((r) => r.query)
    .filter((q): q is string => !!q)
    .slice(0, 15);

  const rankedT = topics?.default.rankedList ?? [];
  const relatedTopics = (rankedT[0]?.rankedKeyword ?? [])
    .map((r) => r.topic?.title)
    .filter((t): t is string => !!t)
    .slice(0, 10);

  return {
    keyword,
    geo,
    avgInterest,
    peakInterest,
    trend,
    topQueries,
    risingQueries,
    relatedTopics,
    samplePoints: timeline.length,
    marketplace: {
      source: "none",
      listingCount: null,
      avgPrice: null,
      minPrice: null,
      maxPrice: null,
      estMonthlyRevenue: null,
      estMonthlySales: null,
      sampledListings: 0,
      titles: [],
      topTags: [],
    },
  };
}
