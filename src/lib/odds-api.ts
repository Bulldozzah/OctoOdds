// Client-facing odds API. The paid key used to live here as
// VITE_ODDS_API_KEY, which Vite inlines into the browser bundle — anyone could
// read it out of devtools and spend the quota. Fetching now happens in server
// functions that call lib/odds-server.ts, so the key stays on the server and
// every user shares one cache instead of each spending their own credits.
//
// The types and normalizeEvents stay here because both halves need them.

import { createServerFn } from "@tanstack/react-start";

/** One bookmaker's three-way prices for a fixture. */
export interface BookOdds {
  key: string;
  title: string;
  W: number;
  D: number;
  L: number;
  /**
   * When this bookmaker last repriced the fixture, epoch ms — 0 when the feed
   * didn't say. Carried through because the price you can actually get is the
   * one the book is still showing: a quote left behind by a book that stopped
   * updating is exactly the one that looks best and isn't there.
   */
  updated: number;
}

/** A fixture normalized from the API, with every usable bookmaker. */
export interface Game {
  id: string;
  home: string;
  away: string;
  commence: string;
  /** Attached by the Scanner after fetching, for display. */
  league?: string;
  books: BookOdds[];
}

export interface League {
  key: string;
  title: string;
}

/**
 * Sports the scanner offers. Only sports with a genuine 3-way (W/D/L) market
 * belong here — the whole cover-bet pipeline prices three outcomes.
 */
export const SPORTS = [{ key: "soccer", label: "Football" }] as const;
export type SportKey = (typeof SPORTS)[number]["key"];

export interface OddsResponse {
  games: Game[];
  /** Credits left this month, straight from the response headers. */
  remaining: string | null;
  used: string | null;
}

export interface OddsResult extends OddsResponse {
  /** True when the server served this from cache, so no credits were spent. */
  cached: boolean;
  fetchedAt: number;
}

interface ApiOutcome {
  name: string;
  price: number;
}
interface ApiMarket {
  key: string;
  /** ISO timestamp; present on newer responses, and more specific than the
   *  bookmaker-level one, so it wins when both are there. */
  last_update?: string;
  outcomes?: ApiOutcome[];
}
interface ApiBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets?: ApiMarket[];
}
interface ApiEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: ApiBookmaker[];
}

/**
 * API event -> Game, where W/D/L are decimal odds for home win / draw / away
 * win. Books missing a three-way market (or any leg) are dropped, as are
 * fixtures left with no usable book. Soccer's h2h is 3-way natively; other
 * sports arrive as the explicit h2h_3_way market — same shape, same handling.
 */
export function normalizeEvents(events: ApiEvent[] | null | undefined): Game[] {
  return (events || [])
    .map((ev) => {
      const books = (ev.bookmakers || [])
        .map((bk) => {
          const market = (bk.markets || []).find((m) => m.key === "h2h" || m.key === "h2h_3_way");
          if (!market) return null;
          const odds = { W: 0, D: 0, L: 0 };
          for (const out of market.outcomes || []) {
            if (out.name === ev.home_team) odds.W = out.price;
            else if (out.name === "Draw") odds.D = out.price;
            else if (out.name === ev.away_team) odds.L = out.price;
          }
          if (!(odds.W > 1 && odds.D > 1 && odds.L > 1)) return null;
          const stamp = Date.parse(market.last_update ?? bk.last_update ?? "");
          return {
            key: bk.key,
            title: bk.title,
            ...odds,
            updated: Number.isFinite(stamp) ? stamp : 0,
          };
        })
        .filter((b): b is BookOdds => b !== null);
      return {
        id: ev.id,
        home: ev.home_team,
        away: ev.away_team,
        commence: ev.commence_time,
        books,
      };
    })
    .filter((g) => g.books.length > 0);
}

/**
 * How old a bookmaker's quote may be before the scanner stops betting on it.
 *
 * This is a judgement call, not a fact the feed gives us: `last_update` says
 * when the book was last seen repricing, and a book that hasn't moved a price
 * in 20 minutes may well still honour it. Too tight a cutoff throws away good
 * prices from slow books; too loose keeps the abandoned quotes that make a
 * combo look profitable and vanish at the counter. Fifteen minutes is the
 * compromise — raise it if scans come back too thin.
 */
export const MAX_QUOTE_AGE_MS = 15 * 60 * 1000;

export interface Freshness {
  games: Game[];
  /** Fixtures dropped because kickoff has already passed. */
  started: number;
  /** Bookmaker quotes dropped for being older than the cutoff. */
  staleQuotes: number;
  /** Fixtures dropped because every quote on them was stale. */
  unpriced: number;
}

/**
 * Drop what can no longer be bet: fixtures that have kicked off, and quotes
 * old enough that the price has probably moved.
 *
 * The odds feed stops pricing a fixture once it starts, but a scan restored
 * from localStorage predates that — an hours-old cache is full of games that
 * have already been played, at the prices they carried when it was taken.
 *
 * Quotes with no timestamp (`updated: 0`) are kept: that means the feed didn't
 * say, or the scan was cached before timestamps were recorded, and a missing
 * timestamp is not evidence of staleness.
 */
export const freshenGames = (
  games: Game[],
  now: number,
  maxQuoteAgeMs: number = MAX_QUOTE_AGE_MS,
): Freshness => {
  let started = 0;
  let staleQuotes = 0;
  let unpriced = 0;
  const out: Game[] = [];

  for (const g of games) {
    const kickoff = Date.parse(g.commence);
    if (Number.isFinite(kickoff) && kickoff <= now) {
      started++;
      continue;
    }
    const books = g.books.filter((b) => !b.updated || now - b.updated <= maxQuoteAgeMs);
    staleQuotes += g.books.length - books.length;
    if (books.length === 0) {
      unpriced++;
      continue;
    }
    out.push(books.length === g.books.length ? g : { ...g, books });
  }

  // Hand back the original array when nothing was dropped. The caller re-runs
  // this on a clock, and the combination search downstream is keyed on array
  // identity — returning a fresh copy every minute would re-scan thousands of
  // combos to arrive at the same board.
  const kept = started === 0 && staleQuotes === 0 ? games : out;
  return { games: kept, started, staleQuotes, unpriced };
};

// ---------------------------------------------------------------- server fns
//
// The handlers below are stripped from the client bundle; the browser gets an
// RPC stub. lib/odds-server.ts is imported dynamically so it never enters the
// client module graph at all.

/** Whether the server has a key, so the UI can explain itself when it doesn't. */
export const oddsStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { oddsKeyConfigured } = await import("./odds-server");
  return { configured: oddsKeyConfigured() };
});

export interface OddsRequest {
  accessToken: string;
  sportKey: string;
  regions: string;
  bookmakers?: string;
  from?: string;
  to?: string;
  /** Ignore the shared cache and pay for a live read. */
  refresh?: boolean;
}

const leaguesFn = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; sport: string }) => d)
  .handler(async ({ data }) => {
    const { loadLeagues, assertApprovedUser } = await import("./odds-server");
    await assertApprovedUser(data.accessToken);
    return loadLeagues(data.sport);
  });

const oddsFn = createServerFn({ method: "POST" })
  .inputValidator((d: OddsRequest) => d)
  .handler(async ({ data }) => {
    const { loadLeagueOdds, assertApprovedUser } = await import("./odds-server");
    // The proxy holds a paid key, so it must not be an open relay: only
    // signed-in, approved accounts can spend from the shared quota.
    await assertApprovedUser(data.accessToken);
    return loadLeagueOdds(
      data.sportKey,
      data.regions,
      data.bookmakers ?? "",
      data.from ?? "",
      data.to ?? "",
      data.refresh ?? false,
    );
  });

/**
 * Leagues currently in season for one sport. The /sports endpoint costs no
 * credits, but the result is cached server-side anyway so a room full of
 * users doesn't each trigger their own call.
 */
export async function fetchLeagues(accessToken: string, sport: SportKey): Promise<League[]> {
  return leaguesFn({ data: { accessToken, sport } });
}

/**
 * Head-to-head (1X2) odds for a league. Passing `bookmakers` (comma-separated
 * keys, e.g. "onexbet,betway") overrides the region and fetches exactly those
 * books — cheaper too. Optional `from`/`to` (ISO, no milliseconds) restrict
 * results to fixtures commencing in that window.
 *
 * Identical requests inside the cache window are served without touching the
 * upstream API, so `cached: true` means no credits were spent. Pass `refresh`
 * to bypass that cache and pay for a live read.
 */
export async function fetchLeagueOdds(
  accessToken: string,
  sportKey: string,
  regions: string,
  bookmakers = "",
  from = "",
  to = "",
  refresh = false,
): Promise<OddsResult> {
  return oddsFn({ data: { accessToken, sportKey, regions, bookmakers, from, to, refresh } });
}

/** Server-held key presence, for disabling the scan controls with a reason. */
export async function fetchOddsConfigured(): Promise<boolean> {
  const { configured } = await oddsStatus();
  return configured;
}
