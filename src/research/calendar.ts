/**
 * US POD event calendar.
 *
 * Maps ~20 recurring US events to their Etsy purchase windows.
 * The window is the period when shoppers actually buy — typically starts
 * 2-6 weeks before the event and closes a few days before (no last-minute POD).
 *
 * getUpcomingEvents(today, lookAheadDays) returns events sorted by urgency:
 *   critical  — window closes in < 7 days (last call)
 *   active    — purchase window is open right now
 *   upcoming  — window opens within 14 days (prepare now)
 *   planning  — window opens in 15..lookAheadDays days (plan ahead)
 */

export type EventUrgency = "critical" | "active" | "upcoming" | "planning";

export type PodCategory = "gift" | "seasonal" | "patriotic" | "humor" | "appreciation";

export const POD_CATEGORIES: PodCategory[] = [
  "gift",
  "seasonal",
  "patriotic",
  "humor",
  "appreciation",
];

export interface UpcomingEvent {
  id: string;
  name: string;
  eventDate: string;         // YYYY-MM-DD
  daysUntilEvent: number;
  daysUntilWindowClose: number; // negative = window already closed
  urgency: EventUrgency;
  keywords: string[];        // Etsy-friendly POD seed keywords
  podCategory: PodCategory;
}

interface PodEventDef {
  id: string;
  name: string;
  getDate: (year: number) => Date;
  windowOpenDays: number;  // days before event when purchase window opens
  windowCloseDays: number; // days before event when window closes (neg = after event)
  keywords: string[];
  podCategory: UpcomingEvent["podCategory"];
}

// ─── Date helpers ────────────────────────────────────────────────────────────

/** nth weekday of a month (n=1 → first, n=2 → second, etc.)
 *  weekday: 0=Sun, 1=Mon, …, 6=Sat */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  let offset = weekday - first.getDay();
  if (offset < 0) offset += 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

/** last weekday of a month */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  let offset = last.getDay() - weekday;
  if (offset < 0) offset += 7;
  return new Date(year, month, last.getDate() - offset);
}

/** Easter (Meeus/Jones/Butcher) */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Use local date parts — toISOString() shifts to UTC and can produce the previous day
// when the local timezone is behind UTC (US timezones).
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Event catalog ───────────────────────────────────────────────────────────

const POD_EVENTS: PodEventDef[] = [
  {
    id: "new-years",
    name: "New Year's Day",
    getDate: (y) => new Date(y, 0, 1),
    windowOpenDays: 12,
    windowCloseDays: 1,
    keywords: ["new year shirt", "new year resolution tee", "cheers new year mug"],
    podCategory: "seasonal",
  },
  {
    id: "mlk-day",
    name: "MLK Day",
    getDate: (y) => nthWeekday(y, 0, 1, 3), // 3rd Monday Jan
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["martin luther king shirt", "civil rights dream tee", "equality mug"],
    podCategory: "patriotic",
  },
  {
    id: "valentines",
    name: "Valentine's Day",
    getDate: (y) => new Date(y, 1, 14),
    windowOpenDays: 28,
    windowCloseDays: 3,
    keywords: ["funny valentines shirt", "love heart tee", "galentines day mug"],
    podCategory: "gift",
  },
  {
    id: "st-patricks",
    name: "St. Patrick's Day",
    getDate: (y) => new Date(y, 2, 17),
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["st patricks day shirt", "lucky irish tee", "shamrock drinking mug"],
    podCategory: "seasonal",
  },
  {
    id: "easter",
    name: "Easter",
    getDate: (y) => easter(y),
    windowOpenDays: 21,
    windowCloseDays: 3,
    keywords: ["funny easter shirt", "happy easter bunny tee", "easter basket gift"],
    podCategory: "seasonal",
  },
  {
    id: "teacher-appreciation",
    name: "Teacher Appreciation Week",
    getDate: (y) => nthWeekday(y, 4, 1, 1), // 1st Monday May
    windowOpenDays: 21,
    windowCloseDays: -5, // window extends 5 days past the start of the week
    keywords: ["funny teacher shirt", "teacher appreciation gift mug", "best teacher tee"],
    podCategory: "appreciation",
  },
  {
    id: "nurses-week",
    name: "Nurses Week",
    getDate: (y) => new Date(y, 4, 6), // May 6–12
    windowOpenDays: 21,
    windowCloseDays: -6,
    keywords: ["funny nurse shirt", "nurse appreciation gift mug", "nurse life tee"],
    podCategory: "appreciation",
  },
  {
    id: "mothers-day",
    name: "Mother's Day",
    getDate: (y) => nthWeekday(y, 4, 0, 2), // 2nd Sunday May
    windowOpenDays: 28,
    windowCloseDays: 3,
    keywords: ["funny mom shirt", "mothers day gift mug", "best mom tee"],
    podCategory: "gift",
  },
  {
    id: "memorial-day",
    name: "Memorial Day",
    getDate: (y) => lastWeekday(y, 4, 1), // last Monday May
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["memorial day patriot shirt", "honor fallen heroes tee", "american flag mug"],
    podCategory: "patriotic",
  },
  {
    id: "graduation",
    name: "Graduation Season",
    getDate: (y) => new Date(y, 4, 10), // May 10 anchor (peak gifting)
    windowOpenDays: 42,
    windowCloseDays: -30, // stays relevant through mid-June
    keywords: ["funny graduation shirt", "class of 2026 tee", "grad gift mug"],
    podCategory: "gift",
  },
  {
    id: "fathers-day",
    name: "Father's Day",
    getDate: (y) => nthWeekday(y, 5, 0, 3), // 3rd Sunday June
    windowOpenDays: 28,
    windowCloseDays: 3,
    keywords: ["funny dad shirt", "fathers day gift mug", "best dad ever tee"],
    podCategory: "gift",
  },
  {
    id: "juneteenth",
    name: "Juneteenth",
    getDate: (y) => new Date(y, 5, 19),
    windowOpenDays: 14,
    windowCloseDays: 0,
    keywords: ["juneteenth celebration shirt", "black freedom tee", "juneteenth pride mug"],
    podCategory: "patriotic",
  },
  {
    id: "fourth-of-july",
    name: "4th of July",
    getDate: (y) => new Date(y, 6, 4),
    windowOpenDays: 24,
    windowCloseDays: 3,
    keywords: ["funny 4th of july shirt", "american patriot tee", "independence day mug"],
    podCategory: "patriotic",
  },
  {
    id: "back-to-school",
    name: "Back to School",
    getDate: (y) => new Date(y, 7, 1), // Aug 1 anchor
    windowOpenDays: 42,
    windowCloseDays: -35, // stays relevant into early September
    keywords: ["funny teacher back to school shirt", "student life tee", "school supply mug"],
    podCategory: "seasonal",
  },
  {
    id: "national-dog-day",
    name: "National Dog Day",
    getDate: (y) => new Date(y, 7, 26),
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["funny dog dad shirt", "dog mom tee", "dog lover mug"],
    podCategory: "humor",
  },
  {
    id: "labor-day",
    name: "Labor Day",
    getDate: (y) => nthWeekday(y, 8, 1, 1), // 1st Monday Sep
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["labor day cookout shirt", "workers pride tee", "bbq dad mug"],
    podCategory: "seasonal",
  },
  {
    id: "national-cat-day",
    name: "National Cat Day",
    getDate: (y) => new Date(y, 9, 29),
    windowOpenDays: 14,
    windowCloseDays: 2,
    keywords: ["funny cat mom shirt", "cat lover tee", "crazy cat lady mug"],
    podCategory: "humor",
  },
  {
    id: "halloween",
    name: "Halloween",
    getDate: (y) => new Date(y, 9, 31),
    windowOpenDays: 42,
    windowCloseDays: 3,
    keywords: ["funny halloween shirt", "witch vibes tee", "spooky season mug"],
    podCategory: "seasonal",
  },
  {
    id: "veterans-day",
    name: "Veterans Day",
    getDate: (y) => new Date(y, 10, 11),
    windowOpenDays: 21,
    windowCloseDays: 2,
    keywords: ["veteran pride shirt", "military family tee", "army gift mug"],
    podCategory: "patriotic",
  },
  {
    id: "thanksgiving",
    name: "Thanksgiving",
    getDate: (y) => nthWeekday(y, 10, 4, 4), // 4th Thursday Nov
    windowOpenDays: 35,
    windowCloseDays: 7,
    keywords: ["funny thanksgiving shirt", "turkey day tee", "thankful grateful mug"],
    podCategory: "seasonal",
  },
  {
    id: "christmas",
    name: "Christmas",
    getDate: (y) => new Date(y, 11, 25),
    windowOpenDays: 56,
    windowCloseDays: 5,
    keywords: ["funny christmas shirt", "ugly christmas tee", "christmas gift mug"],
    podCategory: "gift",
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns POD events relevant within the next `lookAheadDays` days,
 * sorted by urgency (critical → active → upcoming → planning)
 * then by daysUntilEvent ascending.
 */
export function getUpcomingEvents(
  today: Date,
  lookAheadDays: number
): UpcomingEvent[] {
  const year = today.getFullYear();
  const results: UpcomingEvent[] = [];

  // Check current year and next year to handle year-boundary niches
  for (const yearOffset of [0, 1]) {
    const y = year + yearOffset;

    for (const def of POD_EVENTS) {
      const eventDate = def.getDate(y);
      const daysUntil = daysBetween(today, eventDate);

      // Window opens `windowOpenDays` before the event
      const windowOpenDate = new Date(eventDate);
      windowOpenDate.setDate(windowOpenDate.getDate() - def.windowOpenDays);

      // Window closes `windowCloseDays` before (negative = days after) the event
      const windowCloseDate = new Date(eventDate);
      windowCloseDate.setDate(windowCloseDate.getDate() - def.windowCloseDays);

      const daysUntilClose = daysBetween(today, windowCloseDate);
      const daysUntilOpen = daysBetween(today, windowOpenDate);

      // Skip if window already closed
      if (daysUntilClose < 0) continue;

      // Skip if window opens beyond lookahead
      if (daysUntilOpen > lookAheadDays) continue;

      let urgency: EventUrgency;
      if (daysUntilClose < 7 && daysUntilOpen <= 0) {
        urgency = "critical";
      } else if (daysUntilOpen <= 0) {
        urgency = "active";
      } else if (daysUntilOpen <= 14) {
        urgency = "upcoming";
      } else {
        urgency = "planning";
      }

      results.push({
        id: def.id,
        name: def.name,
        eventDate: toISO(eventDate),
        daysUntilEvent: daysUntil,
        daysUntilWindowClose: daysUntilClose,
        urgency,
        keywords: def.keywords,
        podCategory: def.podCategory,
      });
    }
  }

  // Sort: urgency order first, then days until event ascending
  const urgencyRank: Record<EventUrgency, number> = {
    critical: 0,
    active: 1,
    upcoming: 2,
    planning: 3,
  };

  return results.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      a.daysUntilEvent - b.daysUntilEvent
  );
}

// ─── Niche → category inference ───────────────────────────────────────────────

// Generic POD/product words carry no category signal — drop them so matching is
// driven by the distinctive tokens (dad, cat, halloween, veteran, …).
const CATEGORY_STOPWORDS = new Set([
  "shirt", "tee", "tshirt", "t-shirt", "mug", "poster", "gift", "day", "the", "of",
  "and", "for", "a", "to", "lover", "life", "vibes", "best", "happy", "celebration",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !CATEGORY_STOPWORDS.has(t));
}

// Built once: for each category, the multiset of distinctive tokens drawn from
// every event's name + seed keywords. A token's weight = how often it appears.
const CATEGORY_TOKEN_WEIGHTS: Record<PodCategory, Map<string, number>> = (() => {
  const acc = {
    gift: new Map<string, number>(),
    seasonal: new Map<string, number>(),
    patriotic: new Map<string, number>(),
    humor: new Map<string, number>(),
    appreciation: new Map<string, number>(),
  } satisfies Record<PodCategory, Map<string, number>>;

  for (const def of POD_EVENTS) {
    const tokens = [def.name, ...def.keywords].flatMap(tokenize);
    const bucket = acc[def.podCategory];
    for (const t of tokens) bucket.set(t, (bucket.get(t) ?? 0) + 1);
  }
  return acc;
})();

/**
 * Best-effort mapping of an arbitrary niche keyword to a POD category, by token
 * overlap with the calendar's event keywords. Returns null when there's no signal
 * (e.g. a truly evergreen niche). Used by the sales feedback loop to learn which
 * categories actually sell.
 */
export function inferPodCategory(keyword: string): PodCategory | null {
  const tokens = tokenize(keyword);
  if (tokens.length === 0) return null;

  let best: PodCategory | null = null;
  let bestScore = 0;
  for (const category of POD_CATEGORIES) {
    const weights = CATEGORY_TOKEN_WEIGHTS[category];
    let score = 0;
    for (const t of tokens) score += weights.get(t) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

/** Human-readable label for an upcoming event (used in prompts and logs) */
export function eventLabel(e: UpcomingEvent): string {
  const daysLabel =
    e.daysUntilEvent <= 0
      ? "today"
      : e.daysUntilEvent === 1
      ? "tomorrow"
      : `${e.daysUntilEvent} days away`;

  const closeLabel =
    e.daysUntilWindowClose < 7
      ? ` — ⚠️ window closes in ${e.daysUntilWindowClose}d`
      : "";

  return `${e.name} (${e.eventDate}, ${daysLabel})${closeLabel}`;
}
