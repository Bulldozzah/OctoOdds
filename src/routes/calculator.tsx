import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calculator as CalculatorIcon,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  RotateCcw,
  Save,
  Scale,
  Target,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { ExposureWarning } from "@/components/app/exposure-warning";
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
import { useAuth } from "@/lib/auth";
import { supabase, type LoadableBet } from "@/lib/supabase";
import { eventExposures, openBetClashes, selfClashes } from "@/lib/exposure";
import { useOpenBets } from "@/hooks/use-open-bets";
import { cn } from "@/lib/utils";
import {
  OUTCOMES,
  OUTCOME_LABELS,
  SPORTS,
  TEAM_LETTERS,
  TEAM_TABS,
  applyCoverPlan,
  balanceProfitStakes,
  balanceWinStakes,
  computeRows,
  coverPlans,
  deriveScenarioOdds,
  fmt,
  labelScenario,
  makeNames,
  makeOutcomeOdds,
  makeRows,
  scenarioCode,
  scenarioOutcomes,
  scenarioTeams,
  sideWord,
  stakeableIdx,
  toNumber,
  turboBalanceStakes,
  type OutcomeOddsInput,
  type Row,
  type TeamTab,
} from "@/lib/calculator";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: "Calculator — OctoOdds Stake & Scenario Planner" },
      {
        name: "description",
        content:
          "Split a budget across every outcome of 1–4 events, balance stakes for equal profit, target a win amount and export the plan as a PDF.",
      },
      { property: "og:title", content: "Calculator — OctoOdds Stake Planner" },
      {
        property: "og:description",
        content: "Live profit, tax and min-to-cover maths for up to 81 outcome scenarios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalculatorRoute,
});

function CalculatorRoute() {
  return (
    <ProtectedRoute>
      <CalculatorPage />
    </ProtectedRoute>
  );
}

/** Per-tab state: each of the 1/2/3/4 tabs keeps its own rows, names and odds. */
type ByTeams<T> = Record<number, T>;

const initialRows = (): ByTeams<Row[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeRows(n)]));
const initialNames = (): ByTeams<string[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeNames(n)]));
const initialOutcomeOdds = (): ByTeams<OutcomeOddsInput[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeOutcomeOdds(n)]));

function Fieldset({
  legend,
  children,
  action,
}: {
  legend: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4 pt-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <legend className="px-1 font-display text-sm font-semibold">{legend}</legend>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

function CalculatorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // A bet handed over from Scanner, Test or My Bets arrives as router location
  // state. My Bets hands over a full saved row (so it carries an id); Scanner
  // picks are fresh and have none. The id is what stops a reopened bet from
  // warning that it overlaps itself.
  const loadedBet = useRouterState({
    select: (s) =>
      (s.location.state as { loadBet?: LoadableBet & { id?: string } } | undefined)?.loadBet,
  });

  const [sport, setSport] = useState(SPORTS[0].id);
  const [tax, setTax] = useState("0.0");
  const [targetStake, setTargetStake] = useState("100");
  const [activeTeams, setActiveTeams] = useState<TeamTab>(2);
  const [rowsByTeams, setRowsByTeams] = useState<ByTeams<Row[]>>(initialRows);
  const [namesByTeams, setNamesByTeams] = useState<ByTeams<string[]>>(initialNames);
  const [outcomeOddsByTeams, setOutcomeOddsByTeams] =
    useState<ByTeams<OutcomeOddsInput[]>>(initialOutcomeOdds);

  const [targetWin, setTargetWin] = useState("");
  // Which scenario the "Calculate" plan gives up: a row index as a string,
  // "all" to cover everything, or "best" to take whichever pays most.
  const [sacrifice, setSacrifice] = useState("best");
  const [betTitle, setBetTitle] = useState("");
  const [matchInfo, setMatchInfo] = useState<
    { home: string; away: string; league?: string }[] | null
  >(null);
  const [statusMsg, setStatusMsg] = useState("Ready. Enter names and odds to begin.");
  const [busy, setBusy] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [loadedBetId, setLoadedBetId] = useState<string | null>(null);
  // Unsettled bets, for the correlation guard below.
  const { openBets, refresh: refreshOpenBets } = useOpenBets(!!user);

  const rows = rowsByTeams[activeTeams];
  const teamNames = namesByTeams[activeTeams];
  const sportMeta = SPORTS.find((s) => s.id === sport) ?? SPORTS[0];
  const side = (n: number) => sideWord(sportMeta, n);

  const { totalStake, remaining, results } = useMemo(
    () => computeRows(rows, tax, targetStake),
    [rows, tax, targetStake],
  );

  // Excluded rows carry no stake at all, so ticking one Unlikely is a no-op —
  // don't let them count towards the Turbo button's total.
  const unlikelyCount = rows.filter((row) => row.unlikely && !row.excluded).length;

  // Largest Total win the budget can actually deliver: W × Σ1/odds ≤ budget.
  const maxWin = useMemo(() => {
    const budget = toNumber(targetStake);
    const sumInv = stakeableIdx(rows).reduce((a, i) => a + 1 / toNumber(rows[i].odds), 0);
    return budget > 0 && sumInv > 0 ? budget / sumInv : null;
  }, [targetStake, rows]);

  // Live readout inside the Total win field: how far the requested win sits
  // above/below the budget — or, with no budget set, above/below the stake the
  // balance would actually need (W × Σ1/odds over the eligible rows).
  const winDiff = useMemo(() => {
    const w = toNumber(targetWin);
    if (!(w > 0)) return null;
    const budget = toNumber(targetStake);
    if (budget > 0) return ((w - budget) / budget) * 100;
    const sumInv = stakeableIdx(rows).reduce((a, i) => a + 1 / toNumber(rows[i].odds), 0);
    if (!(sumInv > 0)) return null;
    return ((w - w * sumInv) / (w * sumInv)) * 100;
  }, [targetWin, targetStake, rows]);

  const clampWin = (value: number) =>
    maxWin !== null && value > maxWin ? Math.floor(maxWin * 100) / 100 : value;

  const stepTargetWin = (delta: number) => {
    const next = Math.max(0, Math.round((toNumber(targetWin) + delta) * 100) / 100);
    setTargetWin(String(clampWin(next)));
  };

  // ------------------------------------------------------- correlation guard

  const currentEvents = useMemo(
    () => eventExposures(matchInfo, teamNames, activeTeams),
    [matchInfo, teamNames, activeTeams],
  );
  const selfWarnings = useMemo(() => selfClashes(currentEvents), [currentEvents]);
  const openWarnings = useMemo(
    () =>
      openBetClashes(
        currentEvents,
        openBets.filter((b) => b.id !== loadedBetId),
      ),
    [currentEvents, openBets, loadedBetId],
  );
  // What is already riding on the clashing bets, so the banner can state the
  // real combined exposure rather than just this bet's stake.
  const clashedStake = openWarnings.reduce((sum, w) => sum + w.stake, 0);

  // ---------------------------------------------------------------- mutators

  const setRows = (updater: (prev: Row[]) => Row[]) => {
    setRowsByTeams((prev) => ({ ...prev, [activeTeams]: updater(prev[activeTeams]) }));
  };

  const updateRow = (index: number, field: "stake" | "odds", value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const setTeamName = (index: number, value: string) => {
    setNamesByTeams((prev) => ({
      ...prev,
      [activeTeams]: prev[activeTeams].map((nm, i) => (i === index ? value : nm)),
    }));
  };

  /**
   * 2/3/4-event tabs: changing one W/D/L input recomputes every scenario's odds
   * as the product of the relevant outcome odds.
   */
  const setOutcomeOdd = (team: number, outcome: "W" | "D" | "L", value: string) => {
    const n = activeTeams;
    const next = outcomeOddsByTeams[n].map((po, t) =>
      t === team ? { ...po, [outcome]: value } : po,
    );
    setOutcomeOddsByTeams((prev) => ({ ...prev, [n]: next }));
    const derived = deriveScenarioOdds(next, n, Math.pow(3, n));
    setRows((prev) => prev.map((row, i) => ({ ...row, odds: derived[i] })));
  };

  const clearOutcomeOdds = () => {
    setOutcomeOddsByTeams((prev) => ({ ...prev, [activeTeams]: makeOutcomeOdds(activeTeams) }));
    setRows((prev) => prev.map((row) => ({ ...row, odds: "0" })));
    setStatusMsg("Odds cleared.");
  };

  const toggleExclude = (index: number) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, excluded: !row.excluded } : row)),
    );
  };

  const toggleUnlikely = (index: number) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, unlikely: !row.unlikely } : row)),
    );
  };

  /** Bump a losing row's stake by the minimum that makes it break even. */
  const applyMinToCover = (index: number) => {
    const r = results[index];
    if (!r || r.minToCover == null) return;
    const newStake = toNumber(rows[index].stake) + r.minToCover;
    updateRow(index, "stake", String(Math.ceil(newStake * 100) / 100));
  };

  const resetAll = () => {
    setTax("0.0");
    setTargetStake("100");
    setRowsByTeams(initialRows());
    setNamesByTeams(initialNames());
    setOutcomeOddsByTeams(initialOutcomeOdds());
    setBetTitle("");
    setMatchInfo(null);
    setLoadedBetId(null);
    setSelectedRow(null);
    setTargetWin("");
    setSacrifice("best");
    setStatusMsg("Reset to defaults.");
  };

  // -------------------------------------------------------------- balancing

  const balanceProfit = () => {
    const stakes = balanceProfitStakes(rows, tax, targetStake);
    if (!stakes) {
      setStatusMsg(
        "Nothing to balance — set a budget and at least one scenario with odds above 1.",
      );
      return;
    }
    setRows((prev) => prev.map((row, i) => ({ ...row, stake: String(stakes[i]) })));
    setStatusMsg("Balanced: profit is now spread evenly across included scenarios.");
  };

  /**
   * Turbo: the ticked scenarios are staked for the budget back and nothing
   * more, and everything that frees goes on the rest.
   *
   * Whether that pays more than an even Balance depends entirely on whether the
   * included set already clears a profit, so the status line quotes what Balance
   * would have returned rather than asserting an improvement — on a normally
   * priced book Turbo buys the capital guarantee out of the likely scenarios,
   * and saying otherwise would be selling the button rather than describing it.
   */
  const turboBalance = () => {
    const res = turboBalanceStakes(rows, tax, targetStake);
    if (!res.ok) {
      setStatusMsg(res.message);
      return;
    }
    setRows((prev) => prev.map((row, i) => ({ ...row, stake: String(res.stakes[i]) })));
    const delta = res.likelyPayout - res.baselinePayout;
    setStatusMsg(
      `Turbo: ${res.floored} unlikely ${res.floored === 1 ? "scenario returns" : "scenarios return"} ` +
        `${fmt(res.recovered)} — your stake back, no profit. Every other scenario now returns ` +
        `${fmt(res.likelyPayout)} (${signedPct(res.likelyProfitPct)}), ` +
        (delta >= 0.005
          ? `up ${fmt(delta)} on the ${fmt(res.baselinePayout)} an even Balance pays.`
          : delta <= -0.005
            ? `down ${fmt(-delta)} from the ${fmt(res.baselinePayout)} an even Balance pays — these odds carry a bookmaker margin, so the guarantee is being paid for by the scenarios you do expect.`
            : `the same as an even Balance.`),
    );
  };

  const balanceWin = () => {
    const res = balanceWinStakes(rows, targetStake, targetWin);
    if (!res.ok) {
      setStatusMsg(res.message);
      return;
    }
    setRows((prev) => prev.map((row, i) => ({ ...row, stake: String(res.stakes[i]) })));
    setStatusMsg(
      `Balanced Total win at ${fmt(toNumber(targetWin))} — staked ${fmt(res.total)}, remaining ${fmt(res.remaining)}.`,
    );
  };

  // ------------------------------------------------- cover-all-but-one plans

  // Every "give up scenario X" option costed out, so the dropdown can show
  // what each one pays before you commit to it.
  const plans = useMemo(() => coverPlans(rows, tax, targetStake), [rows, tax, targetStake]);
  const coverAllPlan = plans.find((p) => p.sacrifice === null) ?? null;
  const dropPlans = useMemo(() => plans.filter((p) => p.sacrifice !== null), [plans]);
  const bestPlan = useMemo(
    () =>
      dropPlans.reduce<(typeof dropPlans)[number] | null>(
        (best, p) => (best === null || p.profitPct > best.profitPct ? p : best),
        null,
      ),
    [dropPlans],
  );

  const chosenPlan =
    sacrifice === "best"
      ? bestPlan
      : sacrifice === "all"
        ? coverAllPlan
        : (dropPlans.find((p) => p.sacrifice === Number(sacrifice)) ?? null);

  const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  const calculateCover = () => {
    if (!chosenPlan) {
      setStatusMsg(
        "Nothing to calculate — set a budget and give at least two scenarios odds above 1.",
      );
      return;
    }
    const next = applyCoverPlan(rows, tax, targetStake, chosenPlan.sacrifice);
    if (!next) {
      setStatusMsg("Nothing to stake with these odds.");
      return;
    }
    setRows(() => next);
    setSelectedRow(chosenPlan.sacrifice);
    const each = `each covered scenario returns ${chosenPlan.profit >= 0 ? "+" : ""}${fmt(
      chosenPlan.profit,
    )} (${signedPct(chosenPlan.profitPct)})`;
    setStatusMsg(
      chosenPlan.sacrifice === null
        ? `Covered ${chosenPlan.coveredCount} of ${rows.length} scenarios — ${each}.`
        : `Covered ${chosenPlan.coveredCount} of ${rows.length} — ${each}. Uncovered: ${labelScenario(
            rows[chosenPlan.sacrifice].name,
            teamNames,
          )}, which loses the whole ${fmt(toNumber(targetStake))} stake.`,
    );
  };

  // ------------------------------------------------------- load / save / pdf

  useEffect(() => {
    if (!loadedBet) return;
    const bet = loadedBet;
    const count = bet.team_count as TeamTab;
    setActiveTeams(count);
    setTax(String(bet.tax));
    setTargetStake(String(bet.target_stake));
    setRowsByTeams((prev) => ({ ...prev, [count]: bet.rows }));
    setNamesByTeams((prev) => ({
      ...prev,
      [count]:
        Array.isArray(bet.team_names) && bet.team_names.length === count
          ? bet.team_names
          : makeNames(count),
    }));
    // Both Scanner picks and saved bets carry each event's individual W/D/L
    // odds; bets saved before the columns existed fall back to blank.
    setOutcomeOddsByTeams((prev) => ({
      ...prev,
      [count]:
        Array.isArray(bet.outcome_odds) && bet.outcome_odds.length === count
          ? bet.outcome_odds.map((o) => ({ W: o?.W ?? "", D: o?.D ?? "", L: o?.L ?? "" }))
          : makeOutcomeOdds(count),
    }));
    setBetTitle(bet.title || "");
    setMatchInfo(Array.isArray(bet.games) && bet.games.length > 0 ? bet.games : null);
    setLoadedBetId(bet.id ?? null);
    setSacrifice("best");
    setStatusMsg(`Loaded “${bet.title}”.`);
    // Clear the one-shot hand-off so a refresh doesn't reload it.
    void navigate({ to: "/calculator", replace: true, state: {} as never });
  }, [loadedBet, navigate]);

  const saveBet = async () => {
    if (!user) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("bets")
      .insert({
        user_id: user.id,
        title:
          betTitle ||
          `${sportMeta.label} · ${activeTeams} ${side(activeTeams).toLowerCase()} · ${new Date().toLocaleString()}`,
        team_count: activeTeams,
        tax: toNumber(tax),
        target_stake: toNumber(targetStake),
        rows,
        team_names: teamNames,
        // Persist the W/D/L inputs and match-ups too, so reopening the bet from
        // My Bets restores the odds grid exactly as it was saved.
        outcome_odds: outcomeOddsByTeams[activeTeams],
        games: matchInfo,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      setStatusMsg(`Save failed: ${error.message}`);
    } else {
      // The bet on screen is now this saved row. Claiming its id keeps the
      // refresh below from reporting the bet as clashing with itself.
      setLoadedBetId((data as { id: string } | null)?.id ?? null);
      setStatusMsg("Bet saved. View it under “My bets”.");
      setBetTitle("");
      refreshOpenBets();
    }
  };

  // jsPDF drags in html2canvas and canvg — ~400 kB that only matters the moment
  // someone actually exports. Loading it here keeps it off the Calculator's
  // initial chunk, which every approved user lands on.
  const exportPDF = async () => {
    const { exportBetPDF } = await import("@/lib/export-pdf");
    exportBetPDF({
      sport: sportMeta,
      activeTeams,
      rows,
      results,
      teamNames,
      outcomeOdds: outcomeOddsByTeams[activeTeams],
      tax,
      targetStake,
      totalStake,
      betTitle,
    });
  };

  const matchInfoText =
    matchInfo &&
    matchInfo.map((g) => `${g.home} v ${g.away}${g.league ? ` (${g.league})` : ""}`).join("  +  ");

  // ------------------------------------------------------------------ render

  return (
    <AppShell>
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold sm:text-4xl">Calculator</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {sportMeta.icon} {sportMeta.label} · {activeTeams} {side(activeTeams).toLowerCase()} ·{" "}
              {rows.length} outcome combinations · tax &amp; coverage check
            </p>
          </div>

          <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <Select
              value={String(activeTeams)}
              onValueChange={(v) => {
                setActiveTeams(Number(v) as TeamTab);
                setSelectedRow(null);
                // Row indices mean something different on the other tab.
                setSacrifice("best");
              }}
            >
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Number of events">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_TABS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {side(n)} · {Math.pow(3, n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger className="w-full sm:w-[170px]" aria-label="Sport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPORTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.icon} {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="destructive" onClick={resetAll}>
              <RotateCcw className="size-4" /> Reset
            </Button>
            <Button
              className="bg-amber-500 text-white hover:bg-amber-500/90"
              onClick={() => void exportPDF()}
            >
              <Download className="size-4" /> Export PDF
            </Button>
            <Input
              className="w-full sm:w-[180px]"
              placeholder="Bet name"
              value={betTitle}
              onChange={(e) => setBetTitle(e.target.value)}
            />
            <Button onClick={() => void saveBet()} disabled={busy}>
              <Save className="size-4" /> {busy ? "Saving…" : "Save bet"}
            </Button>
          </div>
        </div>

        {/*
          Correlation guard. Scenario odds multiply as if every event were
          independent, and nothing in a single bet's figures can reveal that
          another open bet is riding on the same fixture — so both overlaps get
          stated here, above the numbers they undermine.
        */}
        {(selfWarnings.length > 0 || openWarnings.length > 0) && (
          <div className="mt-4 space-y-2">
            {selfWarnings.length > 0 && (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    The same {side(1).toLowerCase()} appears twice on this bet
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {selfWarnings.map((c, i) => (
                      <li key={i}>
                        {c.sameFixture
                          ? `${c.event} is entered as two separate events.`
                          : `${c.names.join(", ")} is in both ${c.event} and ${c.against}.`}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs">
                    The scenario odds multiply as if these were independent events, so the grid is
                    pricing combinations that cannot both happen. Fix the line-up before staking.
                  </p>
                </div>
              </div>
            )}

            <ExposureWarning clashes={openWarnings} combinedStake={totalStake + clashedStake} />
          </div>
        )}

        <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          {/* ----------------------------------------------- controls column */}
          <aside className="relative h-fit min-w-0 rounded-xl border border-border bg-muted p-4 shadow-card xl:sticky xl:top-6">
            <div className="space-y-4">
              <Fieldset legend="Budget">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="rounded-xl bg-sky-soft px-3 py-2">
                    <p className="text-xs text-accent-foreground/70">Total stake</p>
                    <p className="font-display text-lg font-bold">{fmt(totalStake)}</p>
                  </div>
                  <div className="rounded-xl bg-sky-soft px-3 py-2">
                    <p className="text-xs text-accent-foreground/70">Remaining</p>
                    <p
                      className={cn(
                        "font-display text-lg font-bold",
                        remaining < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {fmt(remaining)}
                    </p>
                  </div>
                  <div className="w-28 space-y-1">
                    <Label htmlFor="budget">Budget</Label>
                    <Input
                      id="budget"
                      type="number"
                      step="1"
                      value={targetStake}
                      onChange={(e) => setTargetStake(e.target.value)}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor="tax">Tax rate</Label>
                    <Input
                      id="tax"
                      type="number"
                      step="0.01"
                      value={tax}
                      onChange={(e) => setTax(e.target.value)}
                    />
                  </div>
                </div>
              </Fieldset>

              <Fieldset
                legend={`${side(2)} & odds`}
                action={
                  <Button
                    size="sm"
                    className="bg-success text-success-foreground hover:bg-success/90"
                    onClick={clearOutcomeOdds}
                    title="Clear the W/D/L inputs and reset all scenario odds"
                  >
                    <Eraser className="size-3.5" /> Clear odds
                  </Button>
                }
              >
                <div className="space-y-2">
                  {Array.from({ length: activeTeams }).map((_, t) => {
                    // 1-event tab: rows are AW, AD, AL in OUTCOMES order, so input k
                    // binds straight to rows[k].odds. Multi-event tabs use the derived
                    // per-participant inputs instead.
                    const oneEvent = activeTeams === 1;
                    const po = outcomeOddsByTeams[activeTeams][t];
                    return (
                      <div
                        key={TEAM_LETTERS[t]}
                        className="flex flex-col gap-2 rounded-xl border border-border p-2 sm:flex-row sm:items-center"
                      >
                        <Input
                          className="h-9 min-w-0 flex-1 text-sm"
                          value={teamNames[t] ?? ""}
                          onChange={(e) => setTeamName(t, e.target.value)}
                          placeholder={`${sportMeta.side} ${TEAM_LETTERS[t]} name`}
                        />
                        <div className="flex shrink-0 gap-1.5">
                          {OUTCOMES.map((o, k) => (
                            <div key={o} className="flex items-center gap-1">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`odds-${t}-${o}`}
                                title={`Odds for ${OUTCOME_LABELS[o]}`}
                              >
                                {o}
                              </label>
                              <Input
                                id={`odds-${t}-${o}`}
                                className="h-9 w-14 px-1.5 text-center text-sm tabular-nums"
                                inputMode="decimal"
                                value={oneEvent ? rows[k].odds : po[o]}
                                onChange={(e) =>
                                  oneEvent
                                    ? updateRow(k, "odds", e.target.value)
                                    : setOutcomeOdd(t, o, e.target.value)
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Fieldset>

              <Fieldset legend="Balancing">
                <div className="flex flex-wrap items-end gap-2">
                  <Button
                    onClick={balanceProfit}
                    title="Redistribute the budget so every included scenario returns the same profit"
                  >
                    <Scale className="size-3.5" /> Balance
                  </Button>
                  <Button
                    variant="outline"
                    onClick={balanceWin}
                    title="Set every included scenario's total win to the amount on the right"
                  >
                    <Target className="size-3.5" /> Balance win
                  </Button>
                  <Button
                    className="bg-sky-deep text-primary-foreground hover:bg-sky-deep/90"
                    onClick={turboBalance}
                    disabled={unlikelyCount === 0}
                    title={
                      unlikelyCount === 0
                        ? "Tick Unlikely on the scenarios you only want your stake back from"
                        : `Stake the ${unlikelyCount} unlikely ${unlikelyCount === 1 ? "scenario" : "scenarios"} for your money back only, and put the rest on the others`
                    }
                  >
                    <Zap className="size-3.5" /> Turbo
                    {unlikelyCount > 0 ? ` (${unlikelyCount})` : ""}
                  </Button>
                  <div className="w-44 space-y-1">
                    <Label htmlFor="target">
                      Total win
                      {maxWin !== null && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          · max {fmt(Math.floor(maxWin * 100) / 100)}
                        </span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        id="target"
                        inputMode="decimal"
                        placeholder="Total win"
                        value={targetWin}
                        onChange={(e) => {
                          const n = toNumber(e.target.value);
                          // The cap bites on the stepper and on a completed
                          // number; partial input ("0.", "-") just passes through.
                          if (maxWin !== null && n > maxWin)
                            setTargetWin(String(Math.floor(maxWin * 100) / 100));
                          else setTargetWin(e.target.value);
                        }}
                        className={cn(
                          "pr-20",
                          maxWin !== null &&
                            toNumber(targetWin) > maxWin + 1e-9 &&
                            "border-destructive text-destructive",
                        )}
                        title={
                          maxWin !== null
                            ? `The budget can deliver at most ${fmt(Math.floor(maxWin * 100) / 100)} total win at these odds`
                            : undefined
                        }
                      />
                      <div className="absolute inset-y-0 right-1 flex items-center gap-1">
                        {winDiff !== null && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                              winDiff >= 0
                                ? "bg-success/15 text-success"
                                : "bg-destructive/15 text-destructive",
                            )}
                            title="Difference between your budget and the requested Total win"
                          >
                            {winDiff >= 0 ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )}
                            {Math.abs(winDiff).toFixed(0)}%
                          </span>
                        )}
                        <div className="flex flex-col">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Increase total win"
                            onClick={() => stepTargetWin(1)}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Decrease total win"
                            onClick={() => stepTargetWin(-1)}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/*
                  Cover all but one. Every option is priced in its own label, so
                  the comparison the dropdown exists to make happens before the
                  click rather than by trying each one in turn.
                */}
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <Label htmlFor="sacrifice">
                    Scenario to give up
                    <span className="ml-1 font-normal text-muted-foreground">
                      (the rest share the budget for equal profit)
                    </span>
                  </Label>
                  <Select
                    value={sacrifice}
                    onValueChange={setSacrifice}
                    disabled={plans.length === 0}
                  >
                    <SelectTrigger id="sacrifice">
                      <SelectValue placeholder="Enter a budget and odds first" />
                    </SelectTrigger>
                    <SelectContent>
                      {bestPlan && (
                        <SelectItem value="best">
                          ★ Best · {scenarioCode(rows[bestPlan.sacrifice as number].name)} ·{" "}
                          {signedPct(bestPlan.profitPct)}
                        </SelectItem>
                      )}
                      {coverAllPlan && (
                        <SelectItem value="all">
                          Give up nothing · cover {coverAllPlan.coveredCount} ·{" "}
                          {signedPct(coverAllPlan.profitPct)}
                        </SelectItem>
                      )}
                      {dropPlans.map((p) => {
                        const name = rows[p.sacrifice as number].name;
                        return (
                          <SelectItem key={p.sacrifice} value={String(p.sacrifice)}>
                            {scenarioCode(name)} · {signedPct(p.profitPct)} ·{" "}
                            {labelScenario(name, teamNames)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={calculateCover}
                    disabled={!chosenPlan}
                    title="Stake every scenario except the one selected, so they all return the same profit"
                  >
                    <CalculatorIcon className="size-3.5" />
                    {chosenPlan
                      ? `Calculate — cover ${chosenPlan.coveredCount} of ${rows.length}`
                      : "Calculate"}
                  </Button>
                  {chosenPlan && chosenPlan.profitPct < 0 && (
                    <p className="text-xs text-warning-foreground">
                      This plan loses {signedPct(chosenPlan.profitPct)} on every covered scenario.
                      {bestPlan && bestPlan.profitPct > 0
                        ? ` The best available is ${scenarioCode(rows[bestPlan.sacrifice as number].name)} at ${signedPct(bestPlan.profitPct)}.`
                        : " No give-up scenario turns a profit at these odds."}
                    </p>
                  )}
                </div>
              </Fieldset>

              <p
                aria-live="polite"
                className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
              >
                {statusMsg}
              </p>
            </div>
          </aside>

          {/* ------------------------------------------ scenario table column */}
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {matchInfoText && (
              <div className="border-b border-border bg-sky-soft/50 px-3 py-2 text-xs text-muted-foreground">
                {matchInfoText}
              </div>
            )}
            <div className="max-h-[500px] overflow-auto md:max-h-[600px] xl:max-h-[calc(100vh-260px)]">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="sticky top-0 z-10 bg-sky-soft/80 backdrop-blur">
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Inc.</th>
                    <th
                      className="px-3 py-3"
                      title="Outcomes you don't expect. Turbo stakes these for your money back only and puts the rest on the others."
                    >
                      Unlikely
                    </th>
                    <th className="px-3 py-3">Scenario</th>
                    <th className="px-3 py-3 text-right">Stake</th>
                    <th className="px-3 py-3 text-right">Odds</th>
                    <th className="px-3 py-3 text-right">Total win</th>
                    <th className="px-3 py-3 text-right">Profit</th>
                    <th className="px-3 py-3 text-center">Status</th>
                    <th className="px-3 py-3">Min to cover</th>
                    <th className="px-3 py-3 text-right">Profit %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const r = results[i];
                    return (
                      <tr
                        key={row.name}
                        onClick={() => setSelectedRow((prev) => (prev === i ? null : i))}
                        className={cn(
                          "border-b border-border/60 transition-colors last:border-0",
                          row.excluded && "opacity-50",
                          selectedRow === i && "bg-accent/40",
                        )}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={!row.excluded}
                            onCheckedChange={() => toggleExclude(i)}
                            aria-label={`Include ${row.name}`}
                            title={
                              row.excluded
                                ? "Excluded from balancing — click to include"
                                : "Included in balancing — click to exclude"
                            }
                          />
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={!!row.unlikely}
                            disabled={row.excluded}
                            onCheckedChange={() => toggleUnlikely(i)}
                            aria-label={`Mark ${row.name} unlikely`}
                            title={
                              row.excluded
                                ? "Excluded rows carry no stake at all, so there is nothing to floor"
                                : row.unlikely
                                  ? "Turbo stakes this for your money back only — click to treat it as likely again"
                                  : "Click if you don't expect this outcome: Turbo will stake it for your money back only"
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs text-muted-foreground">
                            {scenarioTeams(row.name, teamNames)}
                          </div>
                          <div className="font-mono text-sm font-semibold">
                            {scenarioOutcomes(row.name)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <Input
                            className="h-8 w-24 text-right tabular-nums"
                            inputMode="decimal"
                            value={row.stake}
                            onChange={(e) => updateRow(i, "stake", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <Input
                            className="h-8 w-20 text-right tabular-nums"
                            inputMode="decimal"
                            value={row.odds}
                            onChange={(e) => updateRow(i, "odds", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmt(r.gross)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono font-semibold tabular-nums",
                            r.profit >= 0 ? "text-odds-up" : "text-odds-down",
                          )}
                        >
                          {r.profit >= 0 ? "+" : ""}
                          {fmt(r.profit)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            title={r.covered ? "Covered" : "Loss"}
                            className={cn(
                              "text-base font-bold",
                              r.covered ? "text-odds-up" : "text-odds-down",
                            )}
                          >
                            {r.covered ? "▲" : "▼"}
                          </span>
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {r.covered ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : r.minToCover === null ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title="Odds ≤ 1 can never cover the stake"
                            >
                              n/a
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className={cn(
                                "h-7 px-2 text-xs",
                                r.affordable
                                  ? "border-success/40 text-success hover:bg-success/10"
                                  : "border-warning/50 text-warning-foreground hover:bg-warning/10",
                              )}
                              title={
                                r.affordable
                                  ? `Click to stake +${fmt(r.minToCover)} (within Remaining)`
                                  : `Needs +${fmt(r.minToCover)} — exceeds Remaining`
                              }
                              onClick={() => applyMinToCover(i)}
                            >
                              + {fmt(r.minToCover)}
                            </Button>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono tabular-nums",
                            r.profit >= 0 ? "text-odds-up" : "text-odds-down",
                          )}
                        >
                          {r.gross > 0 ? `${r.profitPct.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
