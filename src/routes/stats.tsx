import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Banknote,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Download,
  Percent,
  Scale,
  Target,
  Ticket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { Button } from "@/components/ui/button";
import { supabase, type Bet } from "@/lib/supabase";
import {
  OUTCOME_LABEL,
  PERIODS,
  aggregateByTeam,
  betTeamNames,
  computeBet,
  downloadCSV,
  fmt,
  outcomeOf,
  withinPeriod,
} from "@/lib/bet-stats";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Stats — Betting Performance Dashboard | OctoOdds" },
      {
        name: "description",
        content:
          "Track staked totals, net profit, ROI and win rate from your settled cover bets, with daily charts, an equity curve and per-team performance.",
      },
      { property: "og:title", content: "Stats — Betting Performance Dashboard" },
      {
        property: "og:description",
        content:
          "Profit, ROI and win-rate analytics generated from the bets you saved and settled.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsRoute,
});

function StatsRoute() {
  return (
    <ProtectedRoute>
      <StatsPage />
    </ProtectedRoute>
  );
}

/** Day bucket key, in UTC so server and client agree. */
const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);
const shortDay = (key: string) => {
  const [, m, day] = key.split("-");
  return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
};

const STEPS = [
  {
    title: "Build a bet in the Calculator",
    text: "Enter names, stakes and odds for each scenario, or use the balancing buttons.",
  },
  {
    title: "Save the bet",
    text: "It appears under My bets as Pending — its stake counts as invested and as pending exposure here.",
  },
  {
    title: "Settle it when the games finish",
    text: "On My bets, pick the winning scenario and click Mark winner, or Mark lost if none won.",
  },
  {
    title: "Read your stats",
    text: "This page updates the moment a bet is settled.",
  },
];

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-xl border border-border bg-card p-4 shadow-card", className)}
    >
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: number;
  icon: ComponentType<{ className?: string }>;
}) {
  const color = tone === undefined ? "" : tone >= 0 ? "text-odds-up" : "text-odds-down";
  const Trend = tone === undefined || tone >= 0 ? TrendingUp : TrendingDown;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="rounded-lg bg-sky-soft p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        {tone !== undefined && (
          <Trend className={cn("h-4 w-4", tone >= 0 ? "text-odds-up" : "text-odds-down")} />
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

function StatsPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("30d");
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  // recharts measures the DOM to size itself, so it renders nothing meaningful
  // on the server. Gating the charts on mount keeps SSR output and the first
  // client paint identical instead of relying on them happening to match.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("bets")
        .select("*")
        .order("created_at", { ascending: true });
      if (loadError) setError(loadError.message);
      else setBets((data ?? []) as Bet[]);
      setLoading(false);
    };
    void load();
  }, []);

  const periodDays = PERIODS.find((p) => p.key === period)?.days ?? null;

  const stats = useMemo(() => {
    const inPeriod = bets.filter((b) => withinPeriod(b.created_at, periodDays));
    const computed = inPeriod.map((b) => ({ bet: b, ...computeBet(b) }));

    let totalStaked = 0;
    let settledStaked = 0;
    let pendingStaked = 0;
    let totalReturns = 0;
    let netProfit = 0;
    let settledCount = 0;
    let wins = 0;
    let losses = 0;
    let breakEven = 0;

    computed.forEach((c) => {
      totalStaked += c.totalStaked;
      if (c.settled) {
        settledCount += 1;
        settledStaked += c.totalStaked;
        totalReturns += c.returnAmount;
        netProfit += c.netProfit;
        // A bet that returned exactly what it cost is neither a win nor a
        // loss; counting it as either would misstate the win rate.
        const outcome = outcomeOf(c);
        if (outcome === "won") wins += 1;
        else if (outcome === "lost") losses += 1;
        else breakEven += 1;
      } else {
        pendingStaked += c.totalStaked;
      }
    });

    // Staked per day — includes pending, because it measures activity.
    const byDay: Record<string, number> = {};
    computed.forEach((c) => {
      const k = dayKey(c.bet.created_at);
      byDay[k] = (byDay[k] || 0) + c.totalStaked;
    });
    const stakeSeries = Object.keys(byDay)
      .sort()
      .map((k) => ({ day: shortDay(k), staked: byDay[k] }));

    // Net profit per day — settled only.
    const profitByDay: Record<string, number> = {};
    computed
      .filter((c) => c.settled)
      .forEach((c) => {
        const k = dayKey(c.bet.created_at);
        profitByDay[k] = (profitByDay[k] || 0) + c.netProfit;
      });
    const profitSeries = Object.keys(profitByDay)
      .sort()
      .map((k) => ({ day: shortDay(k), net: profitByDay[k] }));

    // Cumulative net profit — the equity curve.
    let running = 0;
    const equitySeries = computed
      .filter((c) => c.settled)
      .map((c) => {
        running += c.netProfit;
        return { day: shortDay(dayKey(c.bet.created_at)), cumulative: running };
      });

    // Pending stakes are excluded so undecided money doesn't dilute the ratio.
    const roi = settledStaked > 0 ? (netProfit / settledStaked) * 100 : 0;
    const teamStats = aggregateByTeam(computed);

    const ledger = [...computed]
      .sort((a, b) => +new Date(b.bet.created_at) - +new Date(a.bet.created_at))
      .map((c) => ({
        id: c.bet.id,
        date: c.bet.created_at,
        title: c.bet.title || "(untitled)",
        teams: betTeamNames(c.bet).join(", "),
        invested: c.totalStaked,
        returned: c.settled ? c.returnAmount : null,
        net: c.settled ? c.netProfit : null,
        result: OUTCOME_LABEL[outcomeOf(c)],
        winner: c.lost ? "—" : (c.wonRow?.name ?? ""),
      }));

    return {
      betsCount: inPeriod.length,
      totalStaked,
      settledCount,
      pendingCount: inPeriod.length - settledCount,
      pendingStaked,
      totalReturns,
      netProfit,
      roi,
      wins,
      losses,
      breakEven,
      stakeSeries,
      profitSeries,
      equitySeries,
      teamStats,
      ledger,
    };
  }, [bets, periodDays]);

  const exportLedgerCSV = () => {
    const header = ["Date", "Bet", "Teams", "Invested", "Returned", "Net", "Result", "Winner"];
    const rows = stats.ledger.map((l) => [
      formatDate(l.date),
      l.title,
      l.teams,
      l.invested.toFixed(2),
      l.returned == null ? "" : l.returned.toFixed(2),
      l.net == null ? "" : l.net.toFixed(2),
      l.result,
      l.winner,
    ]);
    downloadCSV(`coverbet-ledger-${period}.csv`, [header, ...rows]);
  };

  const donut = [
    { name: "Wins", value: stats.wins, fill: "var(--color-odds-up)" },
    { name: "Losses", value: stats.losses, fill: "var(--color-odds-down)" },
    { name: "Break-even", value: stats.breakEven, fill: "var(--color-muted-foreground)" },
  ].filter((d) => d.value > 0);

  const axis = { stroke: "currentColor", fontSize: 11, className: "text-muted-foreground" };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">Stats</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Generated from your saved bets. Mark the winning scenario under{" "}
              <span className="font-medium text-foreground">My bets</span> for a bet to count as
              settled.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    period === p.key
                      ? "bg-card text-foreground shadow-card"
                      : "text-muted-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={exportLedgerCSV}
              disabled={stats.ledger.length === 0}
            >
              <Download className="size-4" /> Export CSV
            </Button>
          </div>
        </div>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        <button
          onClick={() => setShowHelp((o) => !o)}
          aria-expanded={showHelp}
          className="mt-5 flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          {showHelp ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          How to record stats
        </button>
        {showHelp && (
          <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-card">
            <ol className="grid gap-3 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-soft text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Returns use the winning scenario&apos;s stake × odds, less tax on winnings, so the tax
              rate saved with the bet is already applied. Net profit is that return minus the total
              staked across every scenario. Pending bets count towards staked and exposure only.
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-card">
            <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading…
          </div>
        ) : stats.betsCount === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No bets in this period. Save one from the Calculator, then settle it under My bets.
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Total bets" value={String(stats.betsCount)} icon={Ticket} />
              <Kpi label="Total staked" value={fmt(stats.totalStaked)} icon={Coins} />
              <Kpi label="Returns (settled)" value={fmt(stats.totalReturns)} icon={Banknote} />
              <Kpi
                label="Net profit (settled)"
                value={fmt(stats.netProfit)}
                tone={stats.netProfit}
                icon={TrendingUp}
              />
              <Kpi
                label="ROI (settled)"
                value={`${stats.roi.toFixed(1)}%`}
                tone={stats.roi}
                icon={Percent}
              />
              <Kpi label="Pending exposure" value={fmt(stats.pendingStaked)} icon={Clock} />
              <Kpi
                label="W / L / Pending"
                value={`${stats.wins} / ${stats.losses} / ${stats.pendingCount}`}
                icon={Scale}
              />
              <Kpi
                label="Win rate (settled)"
                icon={Target}
                value={
                  stats.wins + stats.losses > 0
                    ? `${((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0)}%`
                    : "—"
                }
              />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <Card title="Amount staked per day">
                <div className="h-56 w-full">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.stakeSeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                        <XAxis dataKey="day" {...axis} />
                        <YAxis {...axis} width={40} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="staked" fill="var(--color-primary)" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card title="Net profit per day">
                <div className="h-56 w-full">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.profitSeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                        <XAxis dataKey="day" {...axis} />
                        <YAxis {...axis} width={40} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="net" radius={4}>
                          {stats.profitSeries.map((d, i) => (
                            <Cell
                              key={`${d.day}-${i}`}
                              fill={d.net >= 0 ? "var(--color-odds-up)" : "var(--color-odds-down)"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card title="Equity curve (cumulative net)">
                <div className="h-56 w-full">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.equitySeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                        <XAxis dataKey="day" {...axis} />
                        <YAxis {...axis} width={40} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          stroke="var(--color-primary)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card title="Settled outcomes">
                <div className="h-56 w-full">
                  {mounted && donut.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donut}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={75}
                        />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-muted-foreground">
                      Nothing settled in this period yet.
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-4 text-xs">
                  {donut.map((d) => (
                    <span key={d.name} className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: d.fill }}
                        aria-hidden
                      />
                      <strong>{d.value}</strong> {d.name.toLowerCase()}
                    </span>
                  ))}
                </div>
              </Card>
            </div>

            {stats.teamStats.length > 0 && (
              <Card title="Per-team performance" className="mt-4">
                <p className="-mt-1 mb-3 text-xs text-muted-foreground">
                  Each bet&apos;s figures are attributed to every participant it names — “how do I
                  do when this team is in my slip”, not “what did this team earn me”. Column totals
                  therefore exceed account totals, by design.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3">Team</th>
                        <th className="pb-2 pr-3 text-right">Bets</th>
                        <th className="pb-2 pr-3 text-right">Staked</th>
                        <th className="pb-2 pr-3 text-right">Net</th>
                        <th className="pb-2 pr-3 text-right">ROI</th>
                        <th className="pb-2 text-right">Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.teamStats.map((t) => (
                        <tr key={t.team} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-3 font-medium">{t.team}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{t.bets}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {fmt(t.staked)}
                          </td>
                          <td
                            className={cn(
                              "py-2 pr-3 text-right font-mono font-semibold tabular-nums",
                              t.netProfit >= 0 ? "text-odds-up" : "text-odds-down",
                            )}
                          >
                            {t.netProfit >= 0 ? "+" : ""}
                            {fmt(t.netProfit)}
                          </td>
                          <td
                            className={cn(
                              "py-2 pr-3 text-right font-mono tabular-nums",
                              t.roi >= 0 ? "text-odds-up" : "text-odds-down",
                            )}
                          >
                            {t.roi.toFixed(1)}%
                          </td>
                          <td
                            className="py-2 text-right font-mono tabular-nums"
                            title={
                              t.breakEven > 0
                                ? `${t.wins} of ${t.wins + t.losses} decided · ${t.breakEven} break-even excluded`
                                : undefined
                            }
                          >
                            {t.wins + t.losses > 0 ? `${t.winRate.toFixed(0)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card title="Ledger" className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-3">Date</th>
                      <th className="pb-2 pr-3">Bet</th>
                      <th className="pb-2 pr-3 text-right">Invested</th>
                      <th className="pb-2 pr-3 text-right">Returned</th>
                      <th className="pb-2 pr-3 text-right">Net</th>
                      <th className="pb-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.ledger.map((l) => (
                      <tr key={l.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                          {formatDate(l.date)}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="max-w-[18rem] truncate font-medium">{l.title}</div>
                          {l.teams && (
                            <div className="max-w-[18rem] truncate text-xs text-muted-foreground">
                              {l.teams}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {fmt(l.invested)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {l.returned == null ? "—" : fmt(l.returned)}
                        </td>
                        <td
                          className={cn(
                            "py-2 pr-3 text-right font-mono font-semibold tabular-nums",
                            l.net == null
                              ? "text-muted-foreground"
                              : l.net >= 0
                                ? "text-odds-up"
                                : "text-odds-down",
                          )}
                        >
                          {l.net == null ? "—" : fmt(l.net)}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              l.result === "Won" && "bg-success/15 text-success",
                              l.result === "Lost" && "bg-destructive/15 text-destructive",
                              l.result === "Pending" && "bg-muted text-muted-foreground",
                              l.result === "Break-even" && "bg-sky-soft text-sky-deep",
                            )}
                          >
                            {l.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>
    </AppShell>
  );
}
