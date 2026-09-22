import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Eye,
  FlaskConical,
  Radar,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { ComboPreviewModal } from "@/components/app/combo-preview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MAX_QUOTE_AGE_MS,
  SPORTS,
  fetchLeagueOdds,
  fetchLeagues,
  fetchOddsConfigured,
  freshenGames,
  type Game,
  type League,
  type SportKey,
} from "@/lib/odds-api";
import { useAuth } from "@/lib/auth";
import {
  OUTCOMES,
  buildArbBet,
  buildComboBet,
  evalSingleGameArb,
  exclPatternOptions,
  excludePatternKey,
  scanCombos,
  type ArbResult,
  type ComboResult,
  type ScanMode,
} from "@/lib/scanner";
import { getDemoGames } from "@/lib/demo-odds";
import { SCAN_CACHE_KEY } from "@/lib/scan-cache";
import { inTimeWindow } from "@/lib/time-window";
import { fmt } from "@/lib/calculator";
import { eventExposures, openBetClashes } from "@/lib/exposure";
import { useOpenBets } from "@/hooks/use-open-bets";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner — Find Coverable Odds Combinations | OctoOdds" },
      {
        name: "description",
        content:
          "Scan live bookmaker odds by league or date, build 9-, 27- or 81-scenario cover combinations, spot cross-book arbitrage and push the best picks into the calculator.",
      },
      { property: "og:title", content: "Scanner — Coverable Odds Finder" },
      {
        property: "og:description",
        content:
          "Profit-filtered game pairs, triples and quads, cross-book arbitrage and kickoff-window controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScannerRoute,
});

function ScannerRoute() {
  return (
    <ProtectedRoute>
      <ScannerPage />
    </ProtectedRoute>
  );
}

const REGION_OPTIONS = [
  { value: "eu", label: "Europe (incl. 1xBet)" },
  { value: "uk", label: "UK (incl. Betway)" },
  { value: "eu,uk", label: "Europe + UK" },
];

// Restrict a scan to bookmakers you actually hold accounts with — cross-book
// arbs are only placeable when you can bet every leg. 'region' keeps the
// default behaviour (every book in the selected region).
const BOOK_OPTIONS = [
  { value: "region", label: "All in selected region" },
  { value: "onexbet", label: "1xBet only" },
  { value: "betway", label: "Betway only" },
  { value: "onexbet,betway", label: "1xBet + Betway" },
  { value: "onexbet,bet365", label: "1xBet + Bet365" },
  { value: "betway,bet365", label: "Betway + Bet365" },
  { value: "onexbet,betway,bet365", label: "1xBet + Betway + Bet365" },
];

const SORTS = [
  { key: "profit", label: "Highest profit %" },
  { key: "safest", label: "Safest first" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/**
 * Which button asked for a scan. Fetching odds spends from a paid quota, so it
 * must never happen on its own: this page loads, restores a cached scan and
 * re-checks freshness without touching the feed, and only these two gestures
 * cost anything.
 *
 * Requiring it as an argument is the point — an effect or a render cannot call
 * a scan without naming a user action, which turns "please don't auto-scan"
 * from a convention into a compile error.
 */
type ScanTrigger = "scan" | "force";

// Two ways to pick which games get paired: everything from one league, or
// everything (across the selected leagues) kicking off on one calendar day.
const TABS = [
  { key: "league", label: "By league" },
  { key: "date", label: "By date (cross-league)" },
] as const;
type ScanTab = (typeof TABS)[number]["key"];

// Cap how many upcoming games are paired so a big league stays readable.
const MAX_GAMES = 14;
// The date scan merges several leagues, so allow a few more before capping.
const MAX_DATE_GAMES = 30;
// ...but it keeps a bigger pool than it scans, so the kickoff-time window can
// pick from everything the scan paid for rather than from the capped slice.
const MAX_DATE_POOL = 150;
// Regions carry 20+ bookmakers, so single-book mode can qualify thousands of
// rows; only the top N are rendered.
const MAX_RESULTS = 50;

/**
 * Combining four games across a full date scan is C(30,4) × every bookmaker —
 * tens of millions of scenario evaluations, which locks the tab for half a
 * minute. Cap the pool per combo size so the search stays interactive; the
 * games kept are the earliest kickoffs, which is the order they already arrive
 * in. 2-game scans are cheap enough to leave alone.
 */
const POOL_CAP: Record<number, number> = { 2: Infinity, 3: 20, 4: 12 };

/**
 * Take up to `limit` games spread evenly over the leagues that returned any,
 * one per league per pass, each league in kickoff order.
 *
 * Capping the globally-earliest kickoffs instead lets one early league evict
 * every later one, so adding leagues to a scan could _shrink_ the results:
 * the extra league pushed the previous leagues' games out of the cap rather
 * than adding to them. Round-robin keeps every selected league represented.
 */
const allocateAcrossLeagues = (byLeague: Game[][], limit: number): Game[] => {
  const queues = byLeague.map((gs) => [...gs]).filter((q) => q.length > 0);
  const out: Game[] = [];
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (out.length >= limit) break;
      const g = q.shift();
      if (g) out.push(g);
    }
  }
  return out.sort((a, b) => +new Date(a.commence) - +new Date(b.commence));
};

const OUTCOME_WORDS: Record<string, string> = { W: "wins", D: "draws", L: "loses" };

// For the excluded-scenario filter chips: "WL" -> "W+L", "a win + a loss".
const PATTERN_NOUNS: Record<string, string> = { W: "a win", D: "a draw", L: "a loss" };
const patternLabel = (key: string) => key.split("").join("+");
const patternWords = (key: string) =>
  key
    .split("")
    .map((o) => PATTERN_NOUNS[o])
    .join(" + ");

/** "AW + BD" -> "Arsenal wins + Inter draws" (one clause per game). */
const excludeText = (result: ComboResult): string | null => {
  if (!result.excludeLabel) return null;
  return result.excludeLabel
    .split(" + ")
    .map((tok, i) => `${result.games[i].home} ${OUTCOME_WORDS[tok[1]]}`)
    .join(" + ");
};

const kickoff = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

/** Kickoff as a local-time 'YYYY-MM-DD', comparable to an <input type="date">. */
const localDay = (iso: string | Date): string => {
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The Odds API wants commence-time bounds as ISO without milliseconds. */
const apiIso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");

// Scan results are cached in localStorage so navigating away (or reloading)
// doesn't throw away a scan that cost API credits — rescanning is always an
// explicit button click. The Test workbench reads this same cache, so the key
// lives in lib/scan-cache.ts.
const CACHE_KEY = SCAN_CACHE_KEY;

interface ScanCache {
  sport?: SportKey;
  league?: string;
  regions?: string;
  books?: string;
  minPct?: string;
  mode?: ScanMode;
  sortBy?: SortKey;
  teamCount?: number;
  exclFilter?: string[];
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  scanTab?: ScanTab;
  scanDate?: string;
  hideExposed?: boolean;
  selLeagues?: string[];
  dateGames?: Game[] | null;
  dateFetched?: number;
  dateScannedAt?: number | null;
  games?: Game[] | null;
  source?: string;
  credits?: number | string | null;
  scannedAt?: number | null;
}

const loadCache = (): ScanCache => {
  if (typeof window === "undefined") return {};
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as ScanCache) || {};
  } catch {
    return {};
  }
};

const scanAge = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
};

function Card({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section
      title={hint}
      className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Chip({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-sky-soft text-sky-deep"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ScannerPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  // The key lives on the server, so its presence is something we ask for
  // rather than read. Assume absent until the server answers, so the controls
  // never flash enabled.
  const [hasKey, setHasKey] = useState(false);
  // Server functions spend from a shared paid quota, so every call carries the
  // caller's session for the proxy to authorize. The token itself rotates on a
  // schedule, so effects key off whether we have one rather than its value —
  // a new token is not new information about what to fetch.
  const token = session?.access_token ?? "";
  const hasToken = !!token;

  const [sport, setSport] = useState<SportKey>("soccer");
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState("soccer_epl");
  const [regions, setRegions] = useState("eu,uk");
  const [books, setBooks] = useState("region");
  const [minPct, setMinPct] = useState("1");
  const [mode, setMode] = useState<ScanMode>("single");
  const [sortBy, setSortBy] = useState<SortKey>("profit");
  const [teamCount, setTeamCount] = useState(2);
  // Excluded-scenario patterns to keep, e.g. ["WL", "DL"]. Empty = no filter.
  // Keys for every combo size live together; only same-length keys apply.
  const [exclFilter, setExclFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Kickoff time-of-day window, both ends optional. Blank = the whole day.
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  const [scanTab, setScanTab] = useState<ScanTab>("league");
  // Left empty for the server render: "today" depends on the viewer's timezone,
  // so seeding it here would disagree with the client and break hydration.
  const [scanDate, setScanDate] = useState("");
  const [today, setToday] = useState("");
  const [selLeagues, setSelLeagues] = useState<string[]>(["soccer_epl"]);
  const [dateGames, setDateGames] = useState<Game[] | null>(null);
  // How many games the last date scan actually fetched, before the cap — so
  // the summary can admit when it is scanning a subset.
  const [dateFetched, setDateFetched] = useState(0);
  const [dateScannedAt, setDateScannedAt] = useState<number | null>(null);

  const [games, setGames] = useState<Game[] | null>(null); // null = not scanned yet
  const [source, setSource] = useState(""); // 'live' | 'demo'
  const [credits, setCredits] = useState<number | string | null>(null);
  // True when the last scan was answered entirely from the server's shared
  // cache, so it cost no credits — worth saying out loud.
  const [servedFromCache, setServedFromCache] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The combo currently open in the preview modal (null = closed).
  const [preview, setPreview] = useState<ComboResult | null>(null);
  // Unsettled bets, so a combo built on a fixture already staked is flagged
  // here rather than after it has been loaded into the Calculator.
  const { openBets } = useOpenBets(!!session);
  const clashesFor = useCallback(
    (gs: Game[]) => openBetClashes(eventExposures(gs, null, gs.length), openBets),
    [openBets],
  );
  // Whether to drop combos that touch a fixture already staked.
  const [hideExposed, setHideExposed] = useState(false);
  // Guards the cache write until the cache read has happened, so the first
  // render never overwrites a good cache with defaults.
  const [hydrated, setHydrated] = useState(false);
  // Wall clock, ticked once a minute. Kickoffs pass and quotes go stale while
  // the page just sits there, so the freshness pass below needs a "now" that
  // moves. Starts at 0 (never during SSR) so the server and the first client
  // render agree; results only exist after the cache read anyway.
  const [now, setNow] = useState(0);

  // Restore the cache after mount, not during render — the server has no
  // localStorage, so reading it in a state initializer would desync hydration.
  useEffect(() => {
    const c = loadCache();
    // A cache saved before a sport was removed may hold a key that no longer
    // exists — only restore ones the picker still offers.
    if (c.sport && SPORTS.some((s) => s.key === c.sport)) setSport(c.sport);
    if (c.league) setLeague(c.league);
    if (c.regions) setRegions(c.regions);
    if (c.books) setBooks(c.books);
    if (c.minPct) setMinPct(c.minPct);
    if (c.mode) setMode(c.mode);
    if (c.sortBy) setSortBy(c.sortBy);
    if (c.teamCount) setTeamCount(c.teamCount);
    if (c.exclFilter) setExclFilter(c.exclFilter);
    if (c.dateFrom) setDateFrom(c.dateFrom);
    if (c.dateTo) setDateTo(c.dateTo);
    if (c.timeFrom) setTimeFrom(c.timeFrom);
    if (c.timeTo) setTimeTo(c.timeTo);
    if (c.scanTab) setScanTab(c.scanTab);
    if (c.hideExposed) setHideExposed(c.hideExposed);
    // Cached choice wins, but only while it is still scannable: the odds feed
    // drops fixtures the moment they kick off, so a date restored from
    // yesterday's session can never return anything. Fall forward to today
    // rather than let "Rescan this date" spend credits on a guaranteed blank.
    const t = localDay(new Date());
    setToday(t);
    setScanDate(c.scanDate && c.scanDate >= t ? c.scanDate : t);
    if (c.selLeagues) setSelLeagues(c.selLeagues);
    if (c.dateGames) setDateGames(c.dateGames);
    if (c.dateFetched) setDateFetched(c.dateFetched);
    if (c.dateScannedAt) setDateScannedAt(c.dateScannedAt);
    if (c.games) setGames(c.games);
    if (c.source) setSource(c.source);
    if (c.credits != null) setCredits(c.credits);
    if (c.scannedAt) setScannedAt(c.scannedAt);
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetchOddsConfigured()
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The league list is the only upstream call this page makes on its own. It
  // hits /sports, which the quota does not charge for — but reading `token`
  // directly would make every Supabase token rotation (hourly, and on tab
  // focus) re-run it unprompted. Reading it from a ref keeps the request
  // authorized while limiting the effect to what actually changes the answer.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    if (!hasKey || !tokenRef.current) return;
    fetchLeagues(tokenRef.current, sport)
      .then((ls) => {
        setLeagues(ls);
        // Keep the (possibly cache-restored) selection if it's still valid;
        // after a sport switch nothing carries over, so fall to the first.
        setLeague((cur) => (ls.length && !ls.some((l) => l.key === cur) ? ls[0].key : cur));
        setSelLeagues((cur) => {
          const kept = cur.filter((k) => ls.some((l) => l.key === k));
          return kept.length ? kept : ls.length ? [ls[0].key] : [];
        });
      })
      .catch((e: Error) => setError(`Could not load leagues: ${e.message}`));
  }, [hasKey, hasToken, sport]);

  // Persist everything needed to restore this page after navigating away.
  useEffect(() => {
    if (!hydrated) return;
    if (!games && !dateGames) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          sport,
          league,
          regions,
          books,
          minPct,
          mode,
          sortBy,
          teamCount,
          exclFilter,
          dateFrom,
          dateTo,
          timeFrom,
          timeTo,
          scanTab,
          scanDate,
          hideExposed,
          selLeagues,
          dateGames,
          dateFetched,
          dateScannedAt,
          games,
          source,
          credits,
          scannedAt,
        } satisfies ScanCache),
      );
    } catch {
      // Quota/serialization failures just mean no cache — never break the page.
    }
  }, [
    hydrated,
    sport,
    league,
    regions,
    books,
    minPct,
    mode,
    sortBy,
    teamCount,
    exclFilter,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    scanTab,
    scanDate,
    hideExposed,
    selLeagues,
    dateGames,
    dateFetched,
    dateScannedAt,
    games,
    source,
    credits,
    scannedAt,
  ]);

  const leagueTitle = (key: string) => leagues.find((l) => l.key === key)?.title || key;

  const scanLive = async (trigger: ScanTrigger) => {
    // Re-entry guard. The buttons disable on `busy`, but that is React state
    // and lands a tick later, so a fast double-click could otherwise start two
    // scans — and a forced one bypasses the cache, so that is two credits.
    if (busy) return;
    const refresh = trigger === "force";
    setBusy(true);
    setError("");
    try {
      const {
        games: fetched,
        remaining,
        cached: fromCache,
        fetchedAt,
      } = await fetchLeagueOdds(
        token,
        league,
        regions,
        books === "region" ? "" : books,
        "",
        "",
        refresh,
      );
      const title = leagueTitle(league);
      const upcoming = fetched
        .sort((a, b) => +new Date(a.commence) - +new Date(b.commence))
        .slice(0, MAX_GAMES)
        .map((g) => ({ ...g, league: title }));
      setGames(upcoming);
      setSource("live");
      setCredits(remaining);
      setServedFromCache(fromCache);
      // The age of the data, not of the click: a cache hit can be minutes old
      // and used to report itself as "just now".
      setScannedAt(fetchedAt);
      if (upcoming.length === 0)
        setError("No upcoming games with 3-way odds in this league right now.");
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const scanDemo = () => {
    setError("");
    setGames(getDemoGames());
    setSource("demo");
    setScannedAt(Date.now());
  };

  /**
   * Fetch every selected league restricted to the chosen local day, tag each
   * game with its league, and merge — pairing then works across leagues.
   *
   * The odds feed only prices fixtures that have not kicked off yet: a
   * commence-time window that has already elapsed comes back empty however
   * many games were actually played in it. So a past date is refused outright
   * (it would cost credits for a guaranteed blank) and today's window starts
   * at "now" rather than at midnight, which is what the feed answers anyway.
   */
  const scanByDate = async (trigger: ScanTrigger) => {
    if (busy) return; // see the guard in scanLive
    const refresh = trigger === "force";
    if (!scanDate) return; // still hydrating; the date input has no value yet
    if (today && scanDate < today) {
      setError(
        "That date has passed. The odds feed only prices fixtures that have not kicked off, so a past date always comes back empty — pick today or later.",
      );
      return;
    }
    if (selLeagues.length === 0) {
      setError("Select at least one league to scan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const midnight = new Date(`${scanDate}T00:00:00`);
      const end = new Date(midnight.getTime() + 24 * 3600 * 1000);
      // Today's window starts at "now", which made the request URL — and so the
      // shared cache key — unique to the second: two people scanning today ten
      // seconds apart each paid. Rounded down to the minute it is shareable
      // again, and the at-most-60s of already-started window it re-admits is
      // filtered out client-side by the freshness pass anyway.
      const start = new Date(Math.floor(Math.max(+midnight, Date.now()) / 60_000) * 60_000);
      const settled = await Promise.allSettled(
        selLeagues.map((k) =>
          fetchLeagueOdds(
            token,
            k,
            regions,
            books === "region" ? "" : books,
            apiIso(start),
            apiIso(end),
            refresh,
          ),
        ),
      );
      const byLeague: Game[][] = [];
      const failed: string[] = [];
      let remaining: number | null = null;
      let fetched = 0;
      let allCached = true;
      // A date scan merges several league calls, each with its own age. It is
      // only as fresh as its oldest part, so that is what the age badge shows.
      let oldest: number | null = null;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          if (!r.value.cached) allCached = false;
          oldest = oldest == null ? r.value.fetchedAt : Math.min(oldest, r.value.fetchedAt);
          const title = leagueTitle(selLeagues[i]);
          const gs = r.value.games
            .map((g) => ({ ...g, league: title }))
            .sort((a, b) => +new Date(a.commence) - +new Date(b.commence));
          fetched += gs.length;
          if (gs.length > 0) byLeague.push(gs);
          const rem = parseFloat(String(r.value.remaining));
          // Requests run in parallel; the smallest counter is the freshest.
          if (!Number.isNaN(rem)) remaining = remaining == null ? rem : Math.min(remaining, rem);
        } else {
          failed.push(leagueTitle(selLeagues[i]));
        }
      });
      setDateGames(allocateAcrossLeagues(byLeague, MAX_DATE_POOL));
      setDateFetched(fetched);
      setDateScannedAt(oldest ?? Date.now());
      setServedFromCache(allCached && settled.some((r) => r.status === "fulfilled"));
      if (remaining != null) setCredits(remaining);
      if (failed.length > 0) {
        setError(
          `Could not fetch: ${failed.join(", ")}. Results below cover the leagues that worked.`,
        );
      } else if (fetched === 0) {
        setError(
          scanDate === today
            ? "Nothing left to scan today — every fixture in these leagues has already kicked off, and the odds feed stops pricing a game once it starts. Try tomorrow, or add leagues."
            : "No games with 3-way odds on that date in the selected leagues. A league can be in season and still have no fixtures that day.",
        );
      }
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleLeague = (key: string) =>
    setSelLeagues((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // One odds call costs (regions) credits, or 1 per 10 named bookmakers.
  const creditsPerLeague =
    books === "region" ? regions.split(",").length : Math.ceil(books.split(",").length / 10);
  const scanCost = (scanTab === "league" ? 1 : selLeagues.length) * creditsPerLeague;

  const minProfit = Math.max(0, parseFloat(minPct) || 0);

  // Kickoff-date filter applied to the already-fetched games — pure client
  // side, so narrowing the range never costs API credits.
  const filteredGames = useMemo(() => {
    if (!games || (!dateFrom && !dateTo && !timeFrom && !timeTo)) return games;
    return games.filter((g) => {
      const day = localDay(g.commence);
      return (
        (!dateFrom || day >= dateFrom) &&
        (!dateTo || day <= dateTo) &&
        inTimeWindow(g.commence, timeFrom, timeTo)
      );
    });
  }, [games, dateFrom, dateTo, timeFrom, timeTo]);

  /**
   * The date scan holds a pool of up to MAX_DATE_POOL games, so the kickoff
   * window narrows the pool first and only then is the scan cap shared out —
   * picking an evening window gives a full 30 evening games rather than
   * whatever survived a cap applied at fetch time.
   */
  const dateWindow = useMemo(() => {
    if (!dateGames) return null;
    const kept = dateGames.filter((g) => inTimeWindow(g.commence, timeFrom, timeTo));
    const byLeague = new Map<string, Game[]>();
    for (const g of kept) {
      const q = byLeague.get(g.league ?? "");
      if (q) q.push(g);
      else byLeague.set(g.league ?? "", [g]);
    }
    return allocateAcrossLeagues([...byLeague.values()], MAX_DATE_GAMES);
  }, [dateGames, timeFrom, timeTo]);

  // Whichever game list the active tab scans, before the freshness pass.
  const scannedGames = scanTab === "league" ? filteredGames : dateWindow;

  /**
   * What is still bettable. A scan restored from localStorage can be hours
   * old: its fixtures may have kicked off, and its prices may have moved. The
   * feed drops started fixtures on the next fetch, but nothing was re-checking
   * the copy already on screen — so combos were being built, and profits
   * quoted, on games that had already been played.
   */
  const fresh = useMemo(() => {
    if (!scannedGames || !now) return null;
    return freshenGames(scannedGames, now);
  }, [scannedGames, now]);

  // Results below render from this.
  const activeGames = fresh ? fresh.games : scannedGames;

  // The combination search is O(C(n,k) × books) and runs synchronously here,
  // so the pool is capped before it starts — see POOL_CAP.
  const poolCap = POOL_CAP[teamCount] ?? Infinity;
  const searchGames = useMemo(
    () =>
      activeGames && activeGames.length > poolCap ? activeGames.slice(0, poolCap) : activeGames,
    [activeGames, poolCap],
  );
  const poolTrimmed = !!activeGames && !!searchGames && activeGames.length > searchGames.length;

  // Filter keys that apply to the current combo size (2-char keys for pairs,
  // 3-char for triples, 4-char for quads) — the rest are kept in state but ignored.
  const activePatterns = useMemo(
    () => exclFilter.filter((k) => k.length === teamCount),
    [exclFilter, teamCount],
  );

  const { pairs, arbs, patternCounts, prefilterCount } = useMemo(() => {
    if (!searchGames)
      return {
        pairs: [] as ComboResult[],
        arbs: [] as ArbResult[],
        patternCounts: {} as Record<string, number>,
        prefilterCount: 0,
      };
    const scanned = scanCombos(searchGames, mode, minProfit, teamCount);
    // Per-pattern totals from the unfiltered scan, so each chip can say how
    // many results it represents even while others are filtered away.
    const counts: Record<string, number> = {};
    for (const r of scanned) {
      if (r.excludeLabel) {
        const k = excludePatternKey(r.excludeLabel);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    // Keep only combos whose uncovered scenario matches a selected pattern.
    // Full covers have no uncovered scenario and always stay — guaranteed
    // profit should never be hidden by a risk filter.
    const filtered = activePatterns.length
      ? scanned.filter(
          (r) =>
            r.fullCover ||
            (r.excludeLabel != null && activePatterns.includes(excludePatternKey(r.excludeLabel))),
        )
      : scanned;
    // scanCombos returns safest-first; re-sort by profit when asked. Full
    // covers stay pinned on top either way — guaranteed beats risky.
    if (sortBy === "profit") {
      filtered.sort((a, b) => {
        if (a.fullCover !== b.fullCover) return a.fullCover ? -1 : 1;
        return b.profitPct - a.profitPct;
      });
    }
    return {
      pairs: filtered,
      arbs:
        mode === "cross"
          ? searchGames
              .map((g) => evalSingleGameArb(g, minProfit))
              .filter((a): a is ArbResult => a !== null)
          : [],
      patternCounts: counts,
      prefilterCount: scanned.length,
    };
  }, [searchGames, mode, minProfit, sortBy, teamCount, activePatterns]);

  // Exposure filtering sits outside the scan memo above, so toggling it just
  // re-filters rather than re-running the whole combination search.
  const exposedCount = useMemo(
    () => pairs.filter((r) => clashesFor(r.games).length > 0).length,
    [pairs, clashesFor],
  );
  const visiblePairs = useMemo(
    () => (hideExposed ? pairs.filter((r) => clashesFor(r.games).length === 0) : pairs),
    [pairs, hideExposed, clashesFor],
  );

  // Total scenarios for the current combo size (9 for pairs, 27 for triples, 81 for quads).
  const scenarioCount = Math.pow(3, teamCount);
  const comboWord = teamCount === 4 ? "quads" : teamCount === 3 ? "triples" : "pairs";

  const fullCovers = visiblePairs.filter((p) => p.fullCover).length;
  const gamesScanned = searchGames ? searchGames.length : 0;
  const totalResults = visiblePairs.length + arbs.length;

  const openInCalculator = (bet: unknown) =>
    navigate({ to: "/calculator", state: { loadBet: bet } as never });

  const activeScannedAt = scanTab === "date" ? dateScannedAt : scannedAt;
  const sportLeagues = leagues;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">Scanner</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Combines upcoming games into pairs, triples or quads and finds cover bets where all
              but one scenario clears your profit floor — plus true cross-book arbs. Bets are placed
              manually at the bookmaker; the scanner only reads odds.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {servedFromCache && (
              <span
                className="rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success"
                title="Answered from the server's shared cache — the upstream API was not called"
              >
                Served from cache · no credits spent
              </span>
            )}
            {credits != null && (
              <span
                className="rounded-full bg-sky-soft px-3 py-1 font-mono text-xs font-semibold text-sky-deep"
                title="The Odds API credits left this month"
              >
                {credits} API credits left
              </span>
            )}
          </div>
        </header>

        {!hasKey && (
          <Alert tone="info" className="mt-4">
            No odds API key configured. Get a free key at{" "}
            <a
              href="https://the-odds-api.com"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary hover:underline"
            >
              the-odds-api.com
            </a>{" "}
            and add <code className="rounded bg-background px-1">ODDS_API_KEY=your-key</code> to{" "}
            <code className="rounded bg-background px-1">.env</code>, then restart the dev server.
            The name is deliberately not <code className="rounded bg-background px-1">VITE_</code>
            -prefixed so the key stays on the server. Until then, use demo data to try the workflow.
          </Alert>
        )}
        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        {/* Tab bar + sport + bookmakers */}
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="flex w-full flex-wrap rounded-xl bg-muted p-1 sm:w-auto" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={scanTab === t.key}
                onClick={() => {
                  setScanTab(t.key);
                  setError("");
                }}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none",
                  scanTab === t.key
                    ? "bg-card text-foreground shadow-card"
                    : "text-muted-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Every sport here prices as 3-way W/D/L. */}
          <div className="flex flex-wrap gap-1">
            {SPORTS.map((s) => (
              <Button
                key={s.key}
                size="sm"
                variant={sport === s.key ? "default" : "outline"}
                disabled={!hasKey}
                onClick={() => setSport(s.key)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          <Select value={books} onValueChange={setBooks} disabled={!hasKey}>
            <SelectTrigger className="w-full sm:w-[210px]" aria-label="Bookmakers">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOK_OPTIONS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={regions}
            onValueChange={setRegions}
            disabled={!hasKey || books !== "region"}
          >
            <SelectTrigger
              className="w-full sm:w-[180px]"
              aria-label="Region"
              title={
                books !== "region" ? "Ignored while specific bookmakers are selected" : undefined
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGION_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeGames && (
            <span aria-live="polite" className="text-sm text-muted-foreground sm:ml-auto">
              <strong className="text-lg font-extrabold text-primary">{totalResults}</strong>{" "}
              {totalResults === 1 ? "result" : "results"} from {gamesScanned} game
              {gamesScanned === 1 ? "" : "s"}
              {fullCovers > 0 ? ` · ${fullCovers} guaranteed` : ""}
            </span>
          )}
        </div>

        <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* ---------------------------------------------- controls column */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <Card title="Scan settings">
              {scanTab === "league" ? (
                <div className="space-y-1.5">
                  <Label>League</Label>
                  <Select value={league} onValueChange={setLeague} disabled={!hasKey}>
                    <SelectTrigger>
                      <SelectValue placeholder={hasKey ? "Loading leagues…" : "EPL"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sportLeagues.map((l) => (
                        <SelectItem key={l.key} value={l.key}>
                          {l.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="scan-date">Match date</Label>
                  <Input
                    id="scan-date"
                    type="date"
                    value={scanDate}
                    // Past days are unscannable, not merely empty — see scanByDate.
                    min={today || undefined}
                    onChange={(e) => setScanDate(e.target.value)}
                    disabled={!hasKey}
                  />
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                <Label htmlFor="min-profit">Minimum profit %</Label>
                <Input
                  id="min-profit"
                  type="number"
                  min="0"
                  step="0.5"
                  value={minPct}
                  onChange={(e) => setMinPct(e.target.value)}
                />
              </div>

              {scanTab === "date" && scanDate === today && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Today only covers kickoffs still ahead — games already under way are no longer
                  priced, so a rescan later returns fewer of them.
                </p>
              )}
            </Card>

            {scanTab === "date" && (
              <Card title="League selection">
                <p className="mb-2 text-xs text-muted-foreground">
                  {selLeagues.length} selected · ~{scanCost} credit{scanCost === 1 ? "" : "s"} per
                  scan
                </p>
                {sportLeagues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {hasKey ? "Loading in-season leagues…" : "League list needs an API key."}
                  </p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {sportLeagues.map((l) => (
                      <label key={l.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selLeagues.includes(l.key)}
                          onCheckedChange={() => toggleLeague(l.key)}
                        />
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Card>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                className="w-full sm:flex-1"
                disabled={
                  !hasKey ||
                  busy ||
                  (scanTab === "league" && !league) ||
                  (scanTab === "date" && !scanDate)
                }
                onClick={() => void (scanTab === "league" ? scanLive("scan") : scanByDate("scan"))}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />
                {busy
                  ? "Scanning…"
                  : scanTab === "date"
                    ? dateGames
                      ? "Rescan this date"
                      : "Scan this date"
                    : source === "live"
                      ? "Rescan live odds"
                      : "Scan live odds"}
              </Button>
              {/* The shared cache answers repeat scans for a few minutes without
                  touching the feed, which is right for saving credits and wrong
                  when you are pressing rescan precisely because you think prices
                  moved. This is the escape hatch, priced honestly. */}
              <Button
                variant="outline"
                disabled={
                  !hasKey ||
                  busy ||
                  (scanTab === "league" && !league) ||
                  (scanTab === "date" && !scanDate)
                }
                title="Ignore the shared cache and read the feed again — always spends credits"
                onClick={() =>
                  void (scanTab === "league" ? scanLive("force") : scanByDate("force"))
                }
              >
                <RefreshCw className="size-4" /> Force
              </Button>
              {scanTab === "league" && (
                <Button variant="secondary" disabled={busy} onClick={scanDemo}>
                  <FlaskConical className="size-4" /> Demo
                </Button>
              )}
            </div>

            {/* Result shaping — only useful once there is something to shape. */}
            {activeGames && (
              <>
                {scanTab === "league" && (
                  <Card title="Kickoff range" hint="Only pair games kicking off within this range">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="from-date">From</Label>
                        <Input
                          id="from-date"
                          type="date"
                          value={dateFrom}
                          max={dateTo || undefined}
                          onChange={(e) => setDateFrom(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="to-date">To</Label>
                        <Input
                          id="to-date"
                          type="date"
                          value={dateTo}
                          min={dateFrom || undefined}
                          onChange={(e) => setDateTo(e.target.value)}
                        />
                      </div>
                    </div>
                    {(dateFrom || dateTo) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => {
                          setDateFrom("");
                          setDateTo("");
                        }}
                      >
                        Clear range
                      </Button>
                    )}
                  </Card>
                )}

                <Card
                  title="Kickoff time"
                  hint="Only combine games kicking off inside this local-time window"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="from-time">From</Label>
                      <Input
                        id="from-time"
                        type="time"
                        value={timeFrom}
                        onChange={(e) => setTimeFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="to-time">To</Label>
                      <Input
                        id="to-time"
                        type="time"
                        value={timeTo}
                        onChange={(e) => setTimeTo(e.target.value)}
                      />
                    </div>
                  </div>
                  {timeFrom && timeTo && timeFrom > timeTo && (
                    <p className="mt-2 text-xs text-destructive">
                      The window ends before it starts, so nothing matches. Windows do not wrap past
                      midnight.
                    </p>
                  )}
                  {(timeFrom || timeTo) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => {
                        setTimeFrom("");
                        setTimeTo("");
                      }}
                    >
                      Clear time
                    </Button>
                  )}
                </Card>

                <Card title="Combine">
                  <div className="grid grid-cols-3 gap-2">
                    {[2, 3, 4].map((n) => (
                      <Button
                        key={n}
                        className="h-auto min-w-0 whitespace-normal py-2 text-center text-xs"
                        variant={teamCount === n ? "default" : "outline"}
                        onClick={() => setTeamCount(n)}
                        title="How many games to combine per slip"
                      >
                        {n} teams ({Math.pow(3, n)})
                      </Button>
                    ))}
                  </div>
                  {poolTrimmed && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Searching the {searchGames?.length} earliest of {activeGames.length} games —{" "}
                      {teamCount}-game combos grow as C(n,{teamCount}), so the pool is capped to
                      keep the page responsive.
                    </p>
                  )}
                </Card>

                <Card title="Odds source">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="h-auto min-w-0 whitespace-normal py-2 text-center text-xs"
                      variant={mode === "single" ? "default" : "outline"}
                      onClick={() => setMode("single")}
                      title="All legs at one bookmaker — a slip you can actually place"
                    >
                      Same bookmaker ({scenarioCount - 1}/{scenarioCount})
                    </Button>
                    <Button
                      className="h-auto min-w-0 whitespace-normal py-2 text-center text-xs"
                      variant={mode === "cross" ? "default" : "outline"}
                      onClick={() => setMode("cross")}
                      title="Best price per outcome across books — legs placed at different bookmakers"
                    >
                      Best odds across books
                    </Button>
                  </div>
                </Card>

                <Card title="Uncovered scenario">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip
                      active={activePatterns.length === 0}
                      onClick={() =>
                        setExclFilter((cur) => cur.filter((k) => k.length !== teamCount))
                      }
                      title="No filter — show every qualifying combo, whatever scenario is left uncovered"
                    >
                      Any
                    </Chip>
                    {exclPatternOptions(teamCount).map((k) => (
                      <Chip
                        key={k}
                        active={activePatterns.includes(k)}
                        onClick={() =>
                          setExclFilter((cur) =>
                            cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
                          )
                        }
                        title={`Only combos whose uncovered scenario is ${patternWords(k)} — in either game order. Guaranteed full covers always stay.`}
                      >
                        {patternLabel(k)}
                        <span className="ml-1 opacity-60">{patternCounts[k] ?? 0}</span>
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Which outcomes the one uncovered scenario may pair — e.g. W+L keeps only combos
                    that lose when one side wins and the other loses. Which game sits in the A slot
                    is an accident of fetch order, so W+L and L+W are one pattern.
                  </p>
                </Card>

                <Card title="Sort">
                  <div className="grid grid-cols-2 gap-2">
                    {SORTS.map((s) => (
                      <Button
                        key={s.key}
                        className="h-auto min-w-0 whitespace-normal py-2 text-center text-xs"
                        variant={sortBy === s.key ? "default" : "outline"}
                        onClick={() => setSortBy(s.key)}
                        title={
                          s.key === "profit"
                            ? "Order by profit on covered scenarios, highest first"
                            : "Order by lowest chance of the excluded scenario hitting"
                        }
                      >
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>

          {/* ----------------------------------------------- results column */}
          <div className="min-w-0 space-y-4">
            {!activeGames ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No scan yet. Choose a league or a date on the left, then press{" "}
                <strong>Scan live odds</strong> — or try <strong>Demo</strong> to see the workflow
                without spending API credits.
              </div>
            ) : (
              <>
                {/* Scan meta */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-gradient-soft p-3 text-xs text-muted-foreground shadow-card">
                  <span>
                    {scanTab === "date"
                      ? `Live odds · ${
                          gamesScanned < dateFetched
                            ? `${gamesScanned} of ${dateFetched} games`
                            : `${gamesScanned} games`
                        } on ${scanDate}`
                      : `${source === "demo" ? "Demo data" : "Live odds"} · ${
                          filteredGames?.length === games?.length
                            ? `${games?.length} games`
                            : `${filteredGames?.length} of ${games?.length} games in range`
                        }`}
                  </span>
                  <span>
                    <strong className="text-foreground">{visiblePairs.length}</strong>
                    {prefilterCount !== visiblePairs.length ? ` of ${prefilterCount}` : ""}{" "}
                    qualifying {comboWord}
                    {mode === "cross" ? ` · ${arbs.length} arbs` : ""}
                  </span>
                  {activeScannedAt && (
                    <span
                      title="Age of the odds themselves — a scan answered from the shared cache is older than the moment you pressed the button"
                      className={cn(
                        "flex items-center gap-1.5",
                        now &&
                          now - activeScannedAt > MAX_QUOTE_AGE_MS &&
                          "font-semibold text-warning-foreground",
                      )}
                    >
                      <Clock className="size-3.5" /> odds from {scanAge(activeScannedAt)}
                    </span>
                  )}
                  {fresh && (fresh.started > 0 || fresh.staleQuotes > 0) && (
                    <span
                      title={`Kicked-off fixtures and quotes older than ${Math.round(MAX_QUOTE_AGE_MS / 60000)} minutes are not bettable, so they are left out of the combinations`}
                      className="flex items-center gap-1.5"
                    >
                      <AlertTriangle className="size-3.5" />
                      ignored
                      {fresh.started > 0
                        ? ` ${fresh.started} started fixture${fresh.started === 1 ? "" : "s"}`
                        : ""}
                      {fresh.started > 0 && fresh.staleQuotes > 0 ? " ·" : ""}
                      {fresh.staleQuotes > 0
                        ? ` ${fresh.staleQuotes} stale quote${fresh.staleQuotes === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  )}
                  {(exposedCount > 0 || hideExposed) && (
                    <div className="ml-auto flex gap-1">
                      {[
                        { on: false, label: `All (${pairs.length})` },
                        { on: true, label: `Unexposed only (${pairs.length - exposedCount})` },
                      ].map((opt) => (
                        <Button
                          key={String(opt.on)}
                          size="sm"
                          variant={hideExposed === opt.on ? "default" : "outline"}
                          onClick={() => setHideExposed(opt.on)}
                          title={
                            opt.on
                              ? "Hide combos touching a fixture you already have an unsettled bet on"
                              : "Show every qualifying combo, including ones you are already exposed to"
                          }
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Single-game arbs */}
                {mode === "cross" && arbs.length > 0 && (
                  <section>
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                      <ShieldCheck className="size-4 text-success" /> Single-game arbs (risk-free
                      across books)
                    </h2>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {arbs.map((a) => (
                        <div
                          key={a.game.id}
                          className="rounded-xl border border-success/40 bg-success/10 p-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold">
                              {a.game.home} vs {a.game.away}
                            </p>
                            <span className="shrink-0 rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
                              +{a.profitPct.toFixed(2)}%
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {kickoff(a.game.commence)}
                            {a.game.league ? ` · ${a.game.league}` : ""}
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                            {OUTCOMES.map((o) => (
                              <div key={o} className="rounded-lg bg-card p-2">
                                <p className="font-semibold">
                                  {o} {fmt(a.odds[o])}
                                </p>
                                <p className="truncate text-muted-foreground">{a.books[o]}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button size="sm" onClick={() => openInCalculator(buildArbBet(a))}>
                              Load into Calculator <ArrowRight className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Combination results */}
                <section>
                  <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                    <Radar className="size-4 text-primary" />
                    {teamCount === 4
                      ? "Game quads"
                      : teamCount === 3
                        ? "Game triples"
                        : "Game pairs"}
                    <span className="text-sm font-normal text-muted-foreground">
                      {mode === "single"
                        ? "— one bookmaker, best single exclusion"
                        : "— best odds per leg across books"}
                    </span>
                  </h2>

                  {visiblePairs.length === 0 ? (
                    <div className="mt-2 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                      {activeGames.length === 0 &&
                      fresh &&
                      fresh.started + fresh.unpriced > 0 &&
                      (scannedGames?.length ?? 0) > 0
                        ? `This scan has aged out — ${
                            fresh.started > 0
                              ? `${fresh.started} fixture${fresh.started === 1 ? " has" : "s have"} kicked off`
                              : ""
                          }${fresh.started > 0 && fresh.unpriced > 0 ? " and " : ""}${
                            fresh.unpriced > 0
                              ? `${fresh.unpriced} ${fresh.unpriced === 1 ? "has" : "have"} no quote newer than ${Math.round(MAX_QUOTE_AGE_MS / 60000)} minutes`
                              : ""
                          }. Scan again for current prices.`
                        : hideExposed && exposedCount > 0 && pairs.length === exposedCount
                          ? `All ${pairs.length} qualifying ${comboWord} involve a fixture you already have an unsettled bet on. Switch back to All to see them.`
                          : prefilterCount > 0
                            ? `All ${prefilterCount} qualifying ${comboWord} are hidden by the uncovered-scenario filter. Select more patterns or set it back to Any.`
                            : activeGames.length < teamCount
                              ? `Only ${activeGames.length} game${activeGames.length === 1 ? "" : "s"} available — ${teamCount}-team combos need at least ${teamCount}.`
                              : `No ${comboWord} clear ${minProfit}% profit with these odds. Try a lower floor${
                                  teamCount >= 3 ? ", switch to fewer teams," : ""
                                } or ${scanTab === "date" ? "more leagues" : "another league"}.`}
                    </div>
                  ) : (
                    <>
                      {visiblePairs.length > MAX_RESULTS && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Showing the top {MAX_RESULTS} of {visiblePairs.length} qualifying results
                          ({sortBy === "profit" ? "highest profit" : "safest"} first).
                        </p>
                      )}
                      <ul className="mt-2 space-y-3">
                        {visiblePairs.slice(0, MAX_RESULTS).map((r, idx) => (
                          <li
                            key={`${r.games.map((g) => g.id).join("-")}-${r.bookLabel}-${idx}`}
                            className={cn(
                              "rounded-xl border border-border bg-card p-4 shadow-card",
                              r.fullCover && "border-success/40 bg-success/5",
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-xs font-bold",
                                  r.fullCover
                                    ? "bg-success text-success-foreground"
                                    : "bg-sky-soft text-sky-deep",
                                )}
                              >
                                {r.fullCover ? scenarioCount : scenarioCount - 1}/{scenarioCount}{" "}
                                covered
                              </span>
                              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                {r.bookLabel}
                              </span>
                              {clashesFor(r.games).length > 0 && (
                                <span
                                  title="A fixture here is already carrying an unsettled bet — open the preview for details"
                                  className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                                >
                                  <AlertTriangle className="size-3" /> already exposed
                                </span>
                              )}
                              <span className="ml-auto text-lg font-bold text-success">
                                +{r.profitPct.toFixed(2)}%
                              </span>
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {r.games.map((g, i) => (
                                <div key={g.id} className="rounded-xl bg-muted/60 p-3">
                                  <p className="truncate text-sm font-medium">
                                    {g.home} <span className="text-muted-foreground">v</span>{" "}
                                    {g.away}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {kickoff(g.commence)}
                                    {g.league ? ` · ${g.league}` : ""}
                                  </p>
                                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                                    W {fmt(r.gamesOdds[i].W)} · D {fmt(r.gamesOdds[i].D)} · L{" "}
                                    {fmt(r.gamesOdds[i].L)}
                                  </p>
                                </div>
                              ))}
                            </div>

                            <div
                              className={cn(
                                "mt-3 flex items-start gap-2 rounded-xl p-3 text-xs",
                                r.fullCover
                                  ? "bg-success/10 text-success"
                                  : "bg-warning/15 text-warning-foreground",
                              )}
                            >
                              {r.fullCover ? (
                                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                              ) : (
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                              )}
                              <span>
                                {r.fullCover
                                  ? `All ${scenarioCount} scenarios covered — no losing outcome.`
                                  : `${scenarioCount - 1} of ${scenarioCount} covered — loses only if ${excludeText(r)} (~${(r.exclProb * 100).toFixed(0)}% implied chance).`}
                              </span>
                            </div>

                            <div className="mt-3 flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setPreview(r)}>
                                <Eye className="size-3.5" /> Preview
                              </Button>
                              <Button size="sm" onClick={() => openInCalculator(buildComboBet(r))}>
                                Load into Calculator <ArrowRight className="size-3.5" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="mt-6 text-xs text-muted-foreground">
                    <strong>Note:</strong> “{scenarioCount - 1} of {scenarioCount} covered” is not
                    risk-free: the excluded scenario is usually the bookmaker&apos;s favourite
                    outcome, and its stake is lost if it happens. Stakes shown assume a 100 budget —
                    adjust the Budget field after loading. Odds move; re-check them on the bookmaker
                    before placing.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </main>

      <ComboPreviewModal
        result={preview}
        openBets={openBets}
        onClose={() => setPreview(null)}
        onLoad={() => {
          if (preview) openInCalculator(buildComboBet(preview));
          setPreview(null);
        }}
      />
    </AppShell>
  );
}
