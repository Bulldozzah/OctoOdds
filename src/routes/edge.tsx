// The Edge page — a second, opinionated read of the same odds the Scanner
// already fetched.
//
// The Scanner answers "what pays well and lands often". This answers "what is
// actually worth taking", which is a different question with a different (and
// usually less flattering) answer. Nothing here spends API credits: it reads
// the Scanner's cached scan, or bundled demo data.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Eye,
  Gauge,
  Info,
  Layers,
  Scale,
  Store,
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
import { eventExposures, openBetClashes } from "@/lib/exposure";
import { useOpenBets } from "@/hooks/use-open-bets";
import { cn } from "@/lib/utils";
import { freshenGames, MAX_QUOTE_AGE_MS, type Game } from "@/lib/odds-api";
import {
  OUTCOMES,
  bestOdds,
  excludePatternKey,
  exclPatternOptions,
  impliedProb,
  invSum,
  scanCombos,
  buildComboBet,
  type ComboResult,
  type OddsTriple,
  type ScanMode,
} from "@/lib/scanner";
import {
  correlationNote,
  evaluateRows,
  expectedPer100,
  marketMargin,
  matchesExclFilter,
  signedPct,
  type MarketMargin,
} from "@/lib/edge";
import { getDemoGames } from "@/lib/demo-odds";
import { readScanCache } from "@/lib/scan-cache";
import { inTimeWindow } from "@/lib/time-window";
import { supabase, type Bet } from "@/lib/supabase";
import { PERIODS, computeBet, fmt, withinPeriod } from "@/lib/bet-stats";
import { formatDate, formatDateTimeLocal } from "@/lib/format-date";

export const Route = createFileRoute("/edge")({
  head: () => ({
    meta: [
      { title: "Edge — Value Analysis | OctoOdds" },
      {
        name: "description",
        content:
          "Rank cover-bet structures by expected value, compare coverage ladders, read bookmaker margins and check expected versus actual ROI — no API credits spent.",
      },
      { property: "og:title", content: "Edge — Value Analysis | OctoOdds" },
      {
        property: "og:description",
        content:
          "A value-first read of cached odds: expected value ranking, structure ladder, market margins and settled-bet ROI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EdgeRoute,
});

function EdgeRoute() {
  return (
    <ProtectedRoute>
      <EdgePage />
    </ProtectedRoute>
  );
}

const TABS = [
  {
    key: "value",
    label: "Value ranking",
    icon: Scale,
    blurb: "Every structure, ranked by what it is worth rather than what it pays.",
  },
  {
    key: "ladder",
    label: "Structure ladder",
    icon: Layers,
    blurb: "The same odds bet four different ways, side by side.",
  },
  {
    key: "margins",
    label: "Market margins",
    icon: Store,
    blurb: "Shop the overround — the only number that moves expected value.",
  },
  {
    key: "actual",
    label: "Expected vs actual",
    icon: Activity,
    blurb: "What your saved bets were worth at placement, against what they returned.",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Combinatorics grow fast (C(n,k)), and the tightest markets are the only ones
// that can produce good value anyway, so the workbench works from the N
// lowest-overround games rather than everything scanned.
const POOL = 14;
const MAX_ROWS = 40;

/** The odds a given mode would actually get you on one game. */
const oddsForMode = (game: Game, mode: ScanMode): OddsTriple | null => {
  if (game.books.length === 0) return null;
  if (mode === "cross") return bestOdds(game).odds;
  // Single-book mode can only use one book's prices, so the best it can do is
  // that game's tightest book.
  let best: OddsTriple | null = null;
  let bestS = Infinity;
  for (const bk of game.books) {
    const s = invSum(bk);
    if (s < bestS) {
      bestS = s;
      best = { W: bk.W, D: bk.D, L: bk.L };
    }
  }
  return best;
};

const evTone = (per100: number): string =>
  per100 >= 100 ? "text-success" : per100 >= 96 ? "text-warning-foreground" : "text-destructive";

function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-sky-soft/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-display text-lg font-extrabold leading-tight", tone)}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn("min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card", className)}
    >
      {children}
    </section>
  );
}

function EdgePage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabKey>("value");
  const [games, setGames] = useState<Game[] | null>(null);
  const [source, setSource] = useState("");
  // Which Scanner tab the cached games came from — worth naming, since the
  // Scanner's two tabs hold two independent scans.
  const [scanKind, setScanKind] = useState<"league" | "date" | null>(null);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<ScanMode>("cross");
  const [legCount, setLegCount] = useState(2);
  const [minPct, setMinPct] = useState("0");
  // Uncovered-scenario patterns to keep, e.g. ["WL", "DL"]. Keys for every
  // structure size live together; only same-length keys apply to a given row.
  const [exclFilter, setExclFilter] = useState<string[]>([]);
  // Kickoff time-of-day window over the cached games. The checkbox is the
  // master switch, so unticking removes the time factor without losing the
  // typed window.
  const [timeOn, setTimeOn] = useState(false);
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  // Wall clock, so the freshness pass below has a "now" that moves. 0 during
  // SSR so the server and first client render agree.
  const [now, setNow] = useState(0);

  // localStorage is browser-only, so this cannot run in a state initializer
  // without desyncing hydration.
  useEffect(() => {
    const cached = readScanCache();
    if (cached) {
      setGames(cached.games);
      setSource(cached.source === "demo" ? "demo" : "scan");
      setScanKind(cached.tab);
      setScannedAt(cached.scannedAt);
      // Open on the Scanner's own mode; the same fixture prices differently
      // cross-book and single-book, so defaulting elsewhere makes the two
      // pages look like they disagree about the odds.
      if (cached.mode) setMode(cached.mode);
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadDemo = () => {
    setGames(getDemoGames());
    setSource("demo");
    setScanKind(null);
    setScannedAt(Date.now());
  };

  /**
   * What is still bettable. The Scanner's cache can be hours old: its fixtures
   * may have kicked off and its prices may have moved, and ranking a game that
   * has already been played is worse than showing nothing.
   */
  const fresh = useMemo(() => {
    if (!games || !now) return null;
    return freshenGames(games, now);
  }, [games, now]);
  const liveGames = fresh ? fresh.games : games;

  // Games the workbench computes over: the live scan, optionally narrowed to
  // the kickoff window so every structure is built purely from games inside it.
  const timedGames = useMemo(() => {
    if (!liveGames || !timeOn) return liveGames;
    return liveGames.filter((g) => inTimeWindow(g.commence, timeFrom, timeTo));
  }, [liveGames, timeOn, timeFrom, timeTo]);

  // Margins for every scanned game, tightest first. Drives the Margins tab and
  // the pool every other tab computes over.
  const margins = useMemo(() => {
    if (!timedGames) return [];
    return timedGames
      .map((g) => marketMargin(g))
      .filter((m): m is MarketMargin => m !== null)
      .sort((a, b) => (mode === "cross" ? a.bestPct - b.bestPct : a.singlePct - b.singlePct));
  }, [timedGames, mode]);

  const pool = useMemo(() => margins.slice(0, POOL).map((m) => m.game), [margins]);

  const floor = Math.max(0, parseFloat(minPct) || 0);

  /** Every qualifying combo at the selected structure, ranked by expected value. */
  const rankedAll = useMemo(() => {
    if (pool.length < legCount) return [];
    const out = Array.from(scanCombos(pool, mode, floor, legCount), (result) => ({
      result,
      per100: expectedPer100(result.gamesOdds),
      legs: legCount,
    }));
    // Expected value first; among equals prefer the one that lands more often,
    // since variance is the only thing left to choose on.
    return out.sort((a, b) => b.per100 - a.per100 || a.result.exclProb - b.result.exclProb);
  }, [pool, mode, floor, legCount]);

  // How many results each uncovered-scenario pattern would keep, counted before
  // the filter is applied so the chips don't all read 0 once one is selected.
  const patternCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const { result } of rankedAll) {
      if (!result.excludeLabel) continue;
      const key = excludePatternKey(result.excludeLabel);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rankedAll]);

  // Filtering and truncation are deliberately separate steps: `hiddenByFilter`
  // must describe what the pattern chips did, and folding the MAX_ROWS cap into
  // it made the count read the same whatever was selected.
  const matching = useMemo(
    () =>
      rankedAll.filter(({ result, legs: n }) =>
        matchesExclFilter(exclFilter, n, result.excludeLabel, result.fullCover),
      ),
    [rankedAll, exclFilter],
  );

  const ranked = useMemo(() => matching.slice(0, MAX_ROWS), [matching]);

  const openInCalculator = (result: ComboResult) =>
    navigate({ to: "/calculator", state: { loadBet: buildComboBet(result) } as never });

  // Pattern keys are structure-specific, so a stale selection from the previous
  // size would read as a filter that no longer matches anything on screen.
  const changeLegCount = (n: number) => {
    setLegCount(n);
    setExclFilter([]);
  };

  const togglePattern = (k: string) =>
    setExclFilter((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const windowInverted = timeOn && !!timeFrom && !!timeTo && timeFrom > timeTo;
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold">
            <Gauge className="size-6 text-primary" />
            Edge
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A value-first read of the odds the Scanner already fetched. The Scanner ranks on what a
            bet pays and how often it lands; this ranks on what it is worth. Nothing here spends API
            credits.
          </p>
        </div>

        {/* Shared data bar */}
        <Card className="mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Odds source</p>
              <div className="text-sm font-semibold">
                {games ? (
                  <>
                    {source === "demo"
                      ? "Demo data"
                      : `Scanner cache · ${scanKind === "date" ? "date scan" : "league scan"}`}{" "}
                    · {liveGames?.length ?? 0} games
                    {scannedAt ? ` · ${formatDateTimeLocal(scannedAt)}` : ""}
                  </>
                ) : (
                  "Nothing loaded"
                )}
              </div>
              {games && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Built from the {pool.length} tightest{" "}
                  {mode === "cross" ? "cross-book" : "one-book"}{" "}
                  {pool.length === 1 ? "market" : "markets"} of those, so the list differs from the
                  Scanner&apos;s.
                </div>
              )}
              {fresh && (fresh.started > 0 || fresh.staleQuotes > 0) && (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-warning-foreground">
                  <AlertTriangle className="size-3.5" />
                  ignored {fresh.started > 0 ? `${fresh.started} started` : ""}
                  {fresh.started > 0 && fresh.staleQuotes > 0 ? " · " : ""}
                  {fresh.staleQuotes > 0
                    ? `${fresh.staleQuotes} quote${fresh.staleQuotes === 1 ? "" : "s"} older than ${Math.round(MAX_QUOTE_AGE_MS / 60000)} min`
                    : ""}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Odds mode</p>
              <div className="inline-flex rounded-xl bg-muted p-1">
                {(
                  [
                    ["cross", "Best across books"],
                    ["single", "One bookmaker"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setMode(k)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      mode === k ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Kickoff window — narrows the pool every tab computes over. */}
            <div title="Only build from games kicking off inside this local-time window">
              <Label
                className="mb-1 flex w-fit cursor-pointer items-center gap-1.5"
                htmlFor="test-time-on"
              >
                <Checkbox
                  id="test-time-on"
                  checked={timeOn}
                  onCheckedChange={(v) => setTimeOn(Boolean(v))}
                />
                Kickoff time
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                  disabled={!timeOn}
                  aria-label="Kickoff from time"
                  className="w-auto"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                  disabled={!timeOn}
                  aria-label="Kickoff to time"
                  className="w-auto"
                />
              </div>
            </div>

            <Button variant="secondary" size="sm" onClick={loadDemo}>
              Load demo odds
            </Button>
          </div>

          {games && timeOn && (
            <p
              className={cn(
                "mt-3 text-xs",
                windowInverted || timedGames?.length === 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {windowInverted
                ? "The window ends before it starts, so nothing matches. Windows do not wrap past midnight."
                : `${timedGames?.length ?? 0} of ${liveGames?.length ?? 0} games kick off between ${
                    timeFrom || "00:00"
                  } and ${timeTo || "23:59"} — every tab below builds only from those.`}
            </p>
          )}

          {!games && (
            <p className="mt-3 text-sm text-muted-foreground">
              No cached scan found. Run a scan on the{" "}
              <Link to="/scanner" className="font-semibold text-primary hover:underline">
                Scanner
              </Link>{" "}
              and come back, or load demo odds to see how this works.
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Vertical tabs */}
          <nav
            role="tablist"
            aria-orientation="vertical"
            className="flex shrink-0 gap-2 overflow-x-auto lg:w-64 lg:flex-col lg:overflow-visible"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors lg:w-full",
                    tab === t.key
                      ? "border-primary bg-primary text-primary-foreground shadow-card"
                      : "border-border bg-card text-foreground hover:bg-accent/50",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">
            <p className="mb-4 text-sm text-muted-foreground">{active.blurb}</p>

            {tab === "value" && (
              <ValueTab
                ranked={ranked}
                legCount={legCount}
                setLegCount={changeLegCount}
                minPct={minPct}
                setMinPct={setMinPct}
                hasGames={!!games}
                poolSize={pool.length}
                onLoad={openInCalculator}
                exclFilter={exclFilter}
                togglePattern={togglePattern}
                clearPatterns={() => setExclFilter([])}
                patternCounts={patternCounts}
                hiddenByFilter={rankedAll.length - matching.length}
                matchingCount={matching.length}
                maxRows={MAX_ROWS}
              />
            )}
            {tab === "ladder" && (
              <StructuresTab pool={pool} mode={mode} onLoad={openInCalculator} />
            )}
            {tab === "margins" && <MarketsTab margins={margins} mode={mode} />}
            {tab === "actual" && <LedgerTab />}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ value */

function ValueTab({
  ranked,
  legCount,
  setLegCount,
  minPct,
  setMinPct,
  hasGames,
  poolSize,
  onLoad,
  exclFilter,
  togglePattern,
  clearPatterns,
  patternCounts,
  hiddenByFilter,
  matchingCount,
  maxRows,
}: {
  ranked: { result: ComboResult; per100: number; legs: number }[];
  legCount: number;
  setLegCount: (n: number) => void;
  minPct: string;
  setMinPct: (v: string) => void;
  hasGames: boolean;
  poolSize: number;
  onLoad: (r: ComboResult) => void;
  exclFilter: string[];
  togglePattern: (k: string) => void;
  clearPatterns: () => void;
  patternCounts: Record<string, number>;
  /** Results the pattern chips removed — nothing to do with the row cap. */
  hiddenByFilter: number;
  /** Results that survived the chips, before the row cap. */
  matchingCount: number;
  maxRows: number;
}) {
  // The combo open in the preview modal, with the value figures that got it
  // ranked here (null = closed).
  const [preview, setPreview] = useState<{ result: ComboResult; per100: number } | null>(null);
  // correlationNote below flags correlation *inside* a combo; this catches the
  // other kind — a fixture already staked on another bet.
  const { openBets } = useOpenBets();
  const clashesFor = useCallback(
    (gs: Game[]) => openBetClashes(eventExposures(gs, null, gs.length), openBets),
    [openBets],
  );
  const [hideExposed, setHideExposed] = useState(false);
  const exposedCount = useMemo(
    () => ranked.filter((r) => clashesFor(r.result.games).length > 0).length,
    [ranked, clashesFor],
  );
  const visible = useMemo(
    () => (hideExposed ? ranked.filter((r) => clashesFor(r.result.games).length === 0) : ranked),
    [ranked, hideExposed, clashesFor],
  );
  const positive = visible.filter((r) => r.per100 >= 100).length;
  // Only same-length keys act on the current structure, so this — not the
  // length of exclFilter — is whether a filter is actually doing anything.
  const filterOn = exclFilter.some((k) => k.length === legCount);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="test-structure">Structure</Label>
            <Select value={String(legCount)} onValueChange={(v) => setLegCount(Number(v))}>
              <SelectTrigger id="test-structure" className="mt-1 w-auto min-w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} game{n === 1 ? "" : "s"} ({Math.pow(3, n) - 1} of {Math.pow(3, n)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label htmlFor="test-minpct">Min payout %</Label>
            <Input
              id="test-minpct"
              value={minPct}
              onChange={(e) => setMinPct(e.target.value)}
              inputMode="decimal"
              className="mt-1"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The 1-game structure usually ranks best here, because each extra leg multiplies in another
          bookmaker margin.
        </p>

        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">Uncovered scenario</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={clearPatterns}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                exclFilter.length === 0
                  ? "border-primary bg-sky-soft text-sky-deep"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              Any
            </button>
            {exclPatternOptions(legCount).map((k) => (
              <button
                key={k}
                onClick={() => togglePattern(k)}
                title={`Keep only combos whose uncovered scenario is ${k.split("").join(" + ")}`}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-xs font-semibold transition-colors",
                  exclFilter.includes(k)
                    ? "border-primary bg-sky-soft text-sky-deep"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {k.split("").join("+")} <span className="opacity-60">{patternCounts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Which outcomes the one uncovered scenario may pair — e.g. W+L keeps only combos that
            lose when one side wins and the other loses. Which game sits in the A slot is an
            accident of fetch order, so W+L and L+W are one pattern. Guaranteed full covers always
            stay.
            {filterOn ? ` ${matchingCount} of ${matchingCount + hiddenByFilter} kept.` : ""}
          </p>
        </div>
      </Card>

      {!hasGames ? null : visible.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          {hideExposed && exposedCount > 0 && ranked.length === exposedCount
            ? `All ${ranked.length} qualifying results involve a fixture you already have an unsettled bet on. Switch back to All to see them.`
            : filterOn && hiddenByFilter > 0
              ? `All ${hiddenByFilter} qualifying results are hidden by the uncovered-scenario filter. Select more patterns, or set it back to Any.`
              : `Nothing qualifies from the ${poolSize} tightest markets at this payout floor. Lower it, or pick a different structure.`}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 rounded-2xl border border-border bg-card px-4 py-2 shadow-card">
            <span className="font-display text-lg font-extrabold leading-none text-primary">
              {visible.length}
            </span>
            <span className="text-sm font-semibold">ranked by expected value</span>
            <span className="text-xs text-muted-foreground">
              · {positive} above break-even
              {positive === 0 ? " — every option below loses money on average" : ""}
              {matchingCount > maxRows ? ` · top ${maxRows} of ${matchingCount} shown` : ""}
              {filterOn && hiddenByFilter > 0 ? ` · ${hiddenByFilter} filtered out` : ""}
              {hideExposed && exposedCount > 0 ? ` · ${exposedCount} hidden as exposed` : ""}
            </span>
            {(exposedCount > 0 || hideExposed) && (
              <div className="ml-auto flex items-center gap-1">
                {[
                  { on: false, label: `All (${ranked.length})` },
                  { on: true, label: `Unexposed only (${ranked.length - exposedCount})` },
                ].map((opt) => (
                  <Button
                    key={String(opt.on)}
                    size="sm"
                    variant={hideExposed === opt.on ? "default" : "outline"}
                    onClick={() => setHideExposed(opt.on)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {visible.map(({ result, per100, legs: n }, i) => {
            const corr = correlationNote(result.games);
            const hitRate = (1 - result.exclProb) * 100;
            return (
              <Card key={`${n}-${result.games.map((g) => g.id).join("-")}-${i}`}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {n} game{n === 1 ? "" : "s"}
                      </span>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-bold",
                          result.fullCover
                            ? "bg-success text-success-foreground"
                            : "bg-sky-soft text-sky-deep",
                        )}
                      >
                        {result.fullCover
                          ? `all ${Math.pow(3, n)} covered`
                          : `${Math.pow(3, n) - 1} of ${Math.pow(3, n)} covered`}
                      </span>
                      {corr && (
                        <span className="flex items-center gap-1 rounded bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                          <AlertTriangle className="size-3" />
                          {corr}
                        </span>
                      )}
                      {clashesFor(result.games).length > 0 && (
                        <span
                          title="A fixture here is already carrying an unsettled bet — open the preview for details"
                          className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                        >
                          <AlertTriangle className="size-3" />
                          already exposed
                        </span>
                      )}
                    </div>
                    {result.games.map((g) => (
                      <div key={g.id} className="truncate text-sm font-semibold">
                        {g.home} v {g.away}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {formatDateTimeLocal(g.commence)}
                          {g.league ? ` · ${g.league}` : ""}
                        </span>
                      </div>
                    ))}
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      via {result.bookLabel}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreview({ result, per100 })}
                    >
                      <Eye className="size-3.5" /> Preview
                    </Button>
                    <Button size="sm" onClick={() => onLoad(result)}>
                      Load into Calculator <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <StatTile
                    label="Expected per 100"
                    value={per100.toFixed(2)}
                    tone={evTone(per100)}
                    hint={
                      per100 >= 100 ? "genuine edge" : `${signedPct(per100 - 100)} per turnover`
                    }
                  />
                  <StatTile
                    label="Hit rate"
                    value={`${hitRate.toFixed(1)}%`}
                    hint={result.fullCover ? "cannot lose" : "book's implied chance"}
                  />
                  <StatTile
                    label="Pays when it hits"
                    value={signedPct(result.profitPct)}
                    hint={
                      result.excludeLabel ? `loses on ${result.excludeLabel}` : "every scenario"
                    }
                  />
                </div>
              </Card>
            );
          })}
        </>
      )}

      <ComboPreviewModal
        result={preview?.result ?? null}
        openBets={openBets}
        onClose={() => setPreview(null)}
        onLoad={() => {
          if (preview) onLoad(preview.result);
          setPreview(null);
        }}
        extra={
          preview ? (
            // The Scanner's preview answers "what does each scenario pay".
            // Here the ranking is by value, so the preview leads with that.
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="Expected per 100"
                value={preview.per100.toFixed(2)}
                tone={evTone(preview.per100)}
              />
              <StatTile
                label="Hit rate"
                value={`${((1 - preview.result.exclProb) * 100).toFixed(1)}%`}
              />
              <StatTile label="Pays when it hits" value={signedPct(preview.result.profitPct, 1)} />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------- structures */

interface Rung {
  name: string;
  covers: string;
  hitRate: number;
  payout: number;
  per100: number;
  detail: string;
  result?: ComboResult;
}

function StructuresTab({
  pool,
  mode,
  onLoad,
}: {
  pool: Game[];
  mode: ScanMode;
  onLoad: (r: ComboResult) => void;
}) {
  const rungs = useMemo((): Rung[] => {
    if (pool.length === 0) return [];
    const out: Rung[] = [];

    // Baseline: back the single most likely outcome in the tightest market.
    // Same market, same margin, wildly different risk profile — which is the
    // point of showing it next to the 2-of-3 cover.
    const odds = oddsForMode(pool[0], mode);
    if (odds) {
      const fav = OUTCOMES.reduce((a, o) => (odds[o] < odds[a] ? o : a), OUTCOMES[0]);
      out.push({
        name: "Straight single",
        covers: "1 of 3",
        hitRate: impliedProb(odds, fav) * 100,
        payout: (odds[fav] - 1) * 100,
        per100: expectedPer100([odds]),
        detail: `${pool[0].home} v ${pool[0].away} — back ${fav} at ${odds[fav].toFixed(2)}`,
      });
    }

    // Best available cover at each leg count, by expected value.
    for (const n of [1, 2, 3, 4]) {
      if (pool.length < n) continue;
      const best = scanCombos(pool, mode, 0, n)
        .map((result) => ({ result, per100: expectedPer100(result.gamesOdds) }))
        .sort((a, b) => b.per100 - a.per100 || a.result.exclProb - b.result.exclProb)[0];
      if (!best) continue;
      out.push({
        name: `${n}-game cover`,
        covers: `${Math.pow(3, n) - 1} of ${Math.pow(3, n)}`,
        hitRate: (1 - best.result.exclProb) * 100,
        payout: best.result.profitPct,
        per100: best.per100,
        detail: best.result.games.map((g) => `${g.home} v ${g.away}`).join("  +  "),
        result: best.result,
      });
    }
    return out;
  }, [pool, mode]);

  if (rungs.length === 0) {
    return (
      <Card className="text-sm text-muted-foreground">
        Load a scan or demo odds to build the ladder.
      </Card>
    );
  }

  const single = rungs.find((r) => r.name === "Straight single");
  const oneGame = rungs.find((r) => r.name === "1-game cover");
  const twoGame = rungs.find((r) => r.name === "2-game cover");
  const best = rungs.reduce((a, r) => (r.per100 > a.per100 ? r : a), rungs[0]);

  return (
    <div className="space-y-4">
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-3">Structure</th>
              <th className="pb-2 pr-3">Covers</th>
              <th className="pb-2 pr-3 text-right">Hit rate</th>
              <th className="pb-2 pr-3 text-right">Pays when it hits</th>
              <th className="pb-2 pr-3 text-right">Expected per 100</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rungs.map((r) => (
              <tr key={r.name} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="font-semibold">{r.name}</div>
                  <div className="max-w-[18rem] truncate text-xs text-muted-foreground">
                    {r.detail}
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">{r.covers}</td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                  {r.hitRate.toFixed(1)}%
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                  {signedPct(r.payout, 1)}
                </td>
                <td
                  className={cn(
                    "py-2.5 pr-3 text-right font-mono text-base font-extrabold tabular-nums",
                    evTone(r.per100),
                  )}
                >
                  {r.per100.toFixed(2)}
                </td>
                <td className="py-2.5 text-right">
                  {r.result && (
                    <Button size="sm" variant="outline" onClick={() => onLoad(r.result!)}>
                      Load
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {single && oneGame && (
        <Card className="border-primary/30 bg-sky-soft/40">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary">
            <Info className="size-4" />
            What the table is showing
          </div>
          <ul className="space-y-2 text-sm text-foreground">
            <li>
              <span className="font-semibold">Coverage is a variance dial, not an edge dial.</span>{" "}
              The straight single lands {single.hitRate.toFixed(0)}% of the time and the 1-game
              cover lands {oneGame.hitRate.toFixed(0)}% — completely different bets, and yet their
              expected value is {single.per100.toFixed(2)} against {oneGame.per100.toFixed(2)}.
              Identical, because they are priced in the same market. Covering more scenarios buys
              frequency and sells payout at an exactly fair rate.
            </li>
            {twoGame && (
              <li>
                <span className="font-semibold">Leg count is the dial that moves value.</span> Going
                from one game to two takes expected value from {oneGame.per100.toFixed(2)} to{" "}
                {twoGame.per100.toFixed(2)} per 100 — because the second game multiplies in a second
                bookmaker margin. The 8-of-9 badge looks safer than 2-of-3, but it costs you{" "}
                {(oneGame.per100 - twoGame.per100).toFixed(2)} per 100 staked to own it.
              </li>
            )}
            <li>
              <span className="font-semibold">Best on this board:</span> {best.name} at{" "}
              {best.per100.toFixed(2)} per 100.{" "}
              {best.per100 >= 100
                ? "Above break-even — this is a genuine edge, not a risk preference."
                : "Still below 100, so this is the least bad option rather than a good one."}
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- markets */

function MarketsTab({ margins, mode }: { margins: MarketMargin[]; mode: ScanMode }) {
  const [maxPct, setMaxPct] = useState("");

  const cap = parseFloat(maxPct);
  const shown = Number.isFinite(cap)
    ? margins.filter((m) => (mode === "cross" ? m.bestPct : m.singlePct) <= cap)
    : margins;

  if (margins.length === 0) {
    return (
      <Card className="text-sm text-muted-foreground">
        Load a scan or demo odds to see market margins.
      </Card>
    );
  }

  const key = (m: MarketMargin) => (mode === "cross" ? m.bestPct : m.singlePct);
  const values = margins.map(key).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const arbs = margins.filter((m) => m.bestPct < 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Markets" value={String(margins.length)} />
        <StatTile label="Tightest" value={signedPct(values[0])} tone="text-success" />
        <StatTile label="Median" value={signedPct(median)} />
        <StatTile
          label="Below 100%"
          value={String(arbs)}
          tone={arbs > 0 ? "text-success" : undefined}
          hint={arbs > 0 ? "true arbs" : "no free money today"}
        />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div className="w-40">
            <Label htmlFor="test-maxpct">Max margin %</Label>
            <Input
              id="test-maxpct"
              value={maxPct}
              onChange={(e) => setMaxPct(e.target.value)}
              placeholder="any"
              inputMode="decimal"
              className="mt-1"
            />
          </div>
          <p className="flex-1 text-xs text-muted-foreground">
            Expected value is <span className="font-mono">100 / S</span>, and S is built from these
            margins. Widening bookmaker coverage is the only lever here that moves the number —
            everything on the other tabs just reshapes risk.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3">Match</th>
                <th className="pb-2 pr-3 text-right">Books</th>
                <th className="pb-2 pr-3 text-right">Best across books</th>
                <th className="pb-2 text-right">Tightest single book</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.game.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="max-w-[16rem] truncate font-semibold">
                      {m.game.home} v {m.game.away}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTimeLocal(m.game.commence)}
                      {m.game.league ? ` · ${m.game.league}` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                    {m.books}
                  </td>
                  <td
                    className={cn(
                      "py-2 pr-3 text-right font-mono font-bold tabular-nums",
                      m.bestPct < 0 ? "text-success" : "text-foreground",
                    )}
                  >
                    {signedPct(m.bestPct)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {signedPct(m.singlePct)}
                    <span className="ml-2 text-xs">{m.singleBook}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">No market is that tight right now.</p>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- ledger */

function LedgerTab() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("bets")
        .select("*")
        .order("created_at", { ascending: false });
      if (loadError) setError(loadError.message);
      else setBets((data ?? []) as Bet[]);
      setLoading(false);
    };
    void load();
  }, []);

  const days = PERIODS.find((p) => p.key === period)?.days ?? null;

  const rows = useMemo(() => {
    return bets
      .filter((b) => withinPeriod(b.created_at, days))
      .map((bet) => {
        const ev = evaluateRows(bet.rows, bet.tax);
        const actual = computeBet(bet);
        return { bet, ev, actual };
      });
  }, [bets, days]);

  const settled = rows.filter((r) => r.actual.settled && r.ev);
  const totals = settled.reduce(
    (acc, r) => ({
      staked: acc.staked + r.actual.totalStaked,
      expected: acc.expected + (r.ev?.expectedProfit ?? 0),
      actual: acc.actual + r.actual.netProfit,
    }),
    { staked: 0, expected: 0, actual: 0 },
  );

  const expectedRoi = totals.staked > 0 ? (totals.expected / totals.staked) * 100 : 0;
  const actualRoi = totals.staked > 0 ? (totals.actual / totals.staked) * 100 : 0;

  if (loading) return <Card className="text-sm text-muted-foreground">Loading bets…</Card>;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-xs text-muted-foreground">Period</p>
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                period === p.key ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      {settled.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          No settled bets in this period yet. Once bets are settled in{" "}
          <Link to="/my-bets" className="font-semibold text-primary hover:underline">
            My bets
          </Link>
          , this compares what each one was mathematically worth when you placed it against what it
          actually returned.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Settled bets" value={String(settled.length)} />
            <StatTile label="Staked" value={fmt(totals.staked)} />
            <StatTile
              label="Expected ROI"
              value={signedPct(expectedRoi, 1)}
              tone={expectedRoi >= 0 ? "text-success" : "text-destructive"}
              hint="what the odds implied"
            />
            <StatTile
              label="Actual ROI"
              value={signedPct(actualRoi, 1)}
              tone={actualRoi >= 0 ? "text-success" : "text-destructive"}
              hint={`${signedPct(actualRoi - expectedRoi, 1)} vs expected`}
            />
          </div>

          <Card className="text-sm">
            <div className="mb-2 flex items-center gap-2 font-bold text-primary">
              <Info className="size-4" />
              How to read this
            </div>
            <p className="text-muted-foreground">
              Expected ROI is computed from each bet&apos;s own stored odds and stakes — the
              probability-weighted return across every scenario, tax included. It is what the bet
              was worth the moment it was placed, independent of how it happened to land. If actual
              tracks expected over enough bets, the model is sound and the strategy simply bleeds at
              the rate shown. A large gap on {settled.length} bet
              {settled.length === 1 ? "" : "s"} is much more likely to be variance than skill — in
              either direction.
            </p>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3">Bet</th>
                  <th className="pb-2 pr-3 text-right">Staked</th>
                  <th className="pb-2 pr-3 text-right">Win chance</th>
                  <th className="pb-2 pr-3 text-right">Expected</th>
                  <th className="pb-2 text-right">Actual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ bet, ev, actual }) => (
                  <tr key={bet.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="max-w-[18rem] truncate font-semibold">
                        {bet.title || "Untitled bet"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(bet.created_at)} · {bet.team_count} event
                        {bet.team_count === 1 ? "" : "s"}
                        {!actual.settled ? " · pending" : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {fmt(actual.totalStaked)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                      {ev ? `${(ev.winProb * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right font-mono tabular-nums",
                        ev && ev.expectedProfit >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {ev ? fmt(ev.expectedProfit) : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-mono font-bold tabular-nums",
                        !actual.settled
                          ? "text-muted-foreground"
                          : actual.netProfit >= 0
                            ? "text-success"
                            : "text-destructive",
                      )}
                    >
                      {actual.settled ? fmt(actual.netProfit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
