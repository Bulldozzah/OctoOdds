import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleEqual,
  Clock,
  ExternalLink,
  RotateCcw,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase, type Bet, type BetRow } from "@/lib/supabase";
import {
  LOST,
  OUTCOME_LABEL,
  betTeamNames,
  computeBet,
  fmt,
  labelScenario,
  outcomeOf,
  toNumber,
  type BetOutcome,
} from "@/lib/bet-stats";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/my-bets")({
  head: () => ({
    meta: [
      { title: "My Bets — Saved Cover Bet Plans | OctoOdds" },
      {
        name: "description",
        content:
          "Every plan you saved, from pending to settled. Track winners, losses and net profit, and reload any plan back into the calculator.",
      },
      { property: "og:title", content: "My Bets — Saved Cover Bet Plans" },
      { property: "og:description", content: "Bet history, settlement and results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MyBetsRoute,
});

function MyBetsRoute() {
  return (
    <ProtectedRoute>
      <MyBetsPage />
    </ProtectedRoute>
  );
}

type StatusFilter = "all" | BetOutcome;

// Tab order: undecided first, then the three ways a settled bet can end.
const FILTERS: StatusFilter[] = ["all", "pending", "won", "lost", "break-even"];

const STATUS_ICON: Record<BetOutcome, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  won: CheckCircle2,
  lost: XCircle,
  // A bet that returned exactly its stake is neither win nor loss, so it gets
  // neither tone — muted, like the Break-even slice on the Stats donut.
  "break-even": CircleEqual,
};

const STATUS_TONE: Record<BetOutcome, string> = {
  pending: "bg-warning/20 text-warning-foreground",
  won: "bg-success/15 text-success",
  lost: "bg-destructive/15 text-destructive",
  "break-even": "bg-muted text-muted-foreground",
};

/** Pending settlement being confirmed — an editable copy of the bet's rows. */
interface Settling {
  betId: string;
  scenario: string;
  rows: BetRow[];
}

function MyBetsPage() {
  const navigate = useNavigate();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [settling, setSettling] = useState<Settling | null>(null);
  // Deleting a saved bet is irreversible, so it goes through a confirm step.
  const [confirmDelete, setConfirmDelete] = useState<Bet | null>(null);

  const loadBets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setStatusMsg(`Could not load bets: ${error.message}`);
    else setBets((data ?? []) as Bet[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadBets();
  }, []);

  /** Hand the bet to the Calculator via router state. */
  const openBet = (bet: Bet) => navigate({ to: "/calculator", state: { loadBet: bet } as never });

  const deleteBet = async (id: string) => {
    const { error } = await supabase.from("bets").delete().eq("id", id);
    if (error) setStatusMsg(`Delete failed: ${error.message}`);
    else {
      setBets((prev) => prev.filter((b) => b.id !== id));
      setStatusMsg("Bet deleted.");
    }
    setConfirmDelete(null);
  };

  /**
   * Open the confirm panel with editable copies of the saved stakes/odds, so
   * the user can correct them to what was actually wagered before settling.
   */
  const beginSettle = (bet: Bet, scenario: string) => {
    setSettling({ betId: bet.id, scenario, rows: (bet.rows ?? []).map((r) => ({ ...r })) });
  };

  const updateSettleRow = (index: number, field: "stake" | "odds", value: string) => {
    setSettling((s) =>
      s ? { ...s, rows: s.rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)) } : s,
    );
  };

  const settleBet = async (bet: Bet, scenario: string, rows?: BetRow[]) => {
    const won = scenario || null;
    const update: Record<string, unknown> = {
      won_scenario: won,
      settled_at: won ? new Date().toISOString() : null,
    };
    if (rows) update["rows"] = rows;

    const { error } = await supabase.from("bets").update(update).eq("id", bet.id);
    if (error) {
      setStatusMsg(`Could not settle: ${error.message}`);
      return;
    }
    setBets((prev) =>
      prev.map((b) =>
        b.id === bet.id ? { ...b, won_scenario: won, ...(rows ? { rows } : {}) } : b,
      ),
    );
    setPicks((p) => ({ ...p, [bet.id]: won && won !== LOST ? won : "" }));
    setSettling(null);
    setStatusMsg(
      won === LOST
        ? `Marked “${bet.title}” as lost.`
        : won
          ? `Marked winner for “${bet.title}”.`
          : `Reset “${bet.title}”.`,
    );
  };

  // Status is derived, not stored: a bet with a winning scenario can still be
  // a net loss, and the badge reflects the net result. outcomeOf is shared with
  // Stats so the badge here and the counters there can never disagree.
  const statusOf = (bet: Bet): BetOutcome => outcomeOf(computeBet(bet));

  const visible = bets.filter((b) => filter === "all" || statusOf(b) === filter);

  const counts: Record<StatusFilter, number> = {
    all: bets.length,
    pending: bets.filter((b) => statusOf(b) === "pending").length,
    won: bets.filter((b) => statusOf(b) === "won").length,
    lost: bets.filter((b) => statusOf(b) === "lost").length,
    "break-even": bets.filter((b) => statusOf(b) === "break-even").length,
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="font-display text-3xl font-bold">My bets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your previously saved bets, most recent first.
        </p>

        {statusMsg && (
          <Alert tone="info" className="mt-4">
            {statusMsg}
          </Alert>
        )}

        <div className="mt-5 flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                // No `capitalize` — OUTCOME_LABEL is already cased, and the
                // utility would render "All Bets" and fight the hyphen in
                // "Break-even".
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
              )}
            >
              {f === "all" ? "All bets" : OUTCOME_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-card">
            <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading…
          </div>
        ) : bets.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing saved yet. Build a plan in the calculator and hit “Save bet”.
            </p>
            <Button className="mt-4" onClick={() => navigate({ to: "/calculator" })}>
              Open calculator
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No {filter === "all" ? "" : OUTCOME_LABEL[filter].toLowerCase()} bets. Change the filter
            to see the rest.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {visible.map((bet) => {
              const c = computeBet(bet);
              const status = statusOf(bet);
              const teams = betTeamNames(bet);
              const pick = picks[bet.id] ?? bet.won_scenario ?? "";
              const StatusIcon = STATUS_ICON[status];

              return (
                <article
                  key={bet.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-card"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
                            STATUS_TONE[status],
                          )}
                        >
                          <StatusIcon className="size-3" /> {OUTCOME_LABEL[status]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(bet.created_at)}
                        </span>
                      </div>
                      <h3 className="truncate font-display text-base font-semibold">{bet.title}</h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {teams.length > 0 ? `${teams.join(" · ")} — ` : ""}
                        {bet.team_count} event{bet.team_count > 1 ? "s" : ""} · tax{" "}
                        {toNumber(bet.tax)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Staked</div>
                      <div className="font-display text-lg font-bold">{fmt(c.totalStaked)}</div>
                    </div>
                  </div>

                  {c.settled && (
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                      <MiniStat
                        label="Winner"
                        value={
                          c.lost
                            ? "None (lost)"
                            : c.wonRow
                              ? labelScenario(bet, c.wonRow.name)
                              : "—"
                        }
                        icon={!c.lost && c.wonRow ? Trophy : undefined}
                      />
                      <MiniStat label="Returned" value={fmt(c.returnAmount)} />
                      <MiniStat
                        label="Net"
                        value={`${c.netProfit >= 0 ? "+" : ""}${fmt(c.netProfit)}`}
                        tone={c.netProfit >= 0 ? "success" : "danger"}
                      />
                      <MiniStat label="Total staked" value={fmt(c.totalStaked)} />
                    </div>
                  )}

                  {/* Settlement controls */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                      value={pick || "none"}
                      onValueChange={(v) =>
                        setPicks((p) => ({ ...p, [bet.id]: v === "none" ? "" : v }))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[280px]" aria-label="Winning scenario">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Winning scenario…</SelectItem>
                        {(bet.rows ?? []).map((r) => (
                          <SelectItem key={r.name} value={r.name}>
                            {labelScenario(bet, r.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={!pick} onClick={() => beginSettle(bet, pick)}>
                      Mark winner
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => beginSettle(bet, LOST)}>
                      Mark lost
                    </Button>

                    <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

                    <Button size="sm" variant="outline" onClick={() => openBet(bet)}>
                      <ExternalLink className="size-4" /> Open
                    </Button>
                    {c.settled && (
                      <Button size="sm" variant="outline" onClick={() => void settleBet(bet, "")}>
                        <RotateCcw className="size-4" /> Reset
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(bet)}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </div>

                  {settling && settling.betId === bet.id && (
                    <SettleConfirm
                      bet={bet}
                      settling={settling}
                      onPickWinner={(name) =>
                        setSettling((s) => (s ? { ...s, scenario: name } : s))
                      }
                      onUpdateRow={updateSettleRow}
                      onConfirm={() => void settleBet(bet, settling.scenario, settling.rows)}
                      onCancel={() => setSettling(null)}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bet?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.title}” will be removed permanently, along with its settlement and
              everything Stats derives from it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && void deleteBet(confirmDelete.id)}
            >
              Delete bet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function SettleConfirm({
  bet,
  settling,
  onPickWinner,
  onUpdateRow,
  onConfirm,
  onCancel,
}: {
  bet: Bet;
  settling: Settling;
  onPickWinner: (name: string) => void;
  onUpdateRow: (index: number, field: "stake" | "odds", value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isLoss = settling.scenario === LOST;
  // Live preview using the edited rows, so the figures update as you type.
  const preview = computeBet({
    rows: settling.rows,
    tax: bet.tax,
    won_scenario: settling.scenario,
  });

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-sky-soft/50 p-4">
      <p className="text-sm font-semibold">
        {isLoss
          ? "Confirm loss — adjust stakes to what was actually wagered:"
          : `Confirm win for “${labelScenario(bet, settling.scenario)}” — adjust stakes/odds to what was actually wagered:`}
      </p>
      {!isLoss && (
        <p className="mt-1 text-xs text-muted-foreground">
          Click a scenario below to change which one won.
        </p>
      )}

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
        {settling.rows.map((r, i) => {
          const isWinner = !isLoss && r.name === settling.scenario;
          return (
            <div
              key={r.name}
              onClick={() => !isLoss && onPickWinner(r.name)}
              title={isLoss ? undefined : "Mark this scenario as the winner"}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border px-2 py-1.5",
                isWinner ? "border-success/50 bg-success/10" : "border-transparent",
                !isLoss && "cursor-pointer hover:bg-accent/50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {!isLoss && (
                  <input
                    type="radio"
                    name={`winner-${bet.id}`}
                    checked={isWinner}
                    onChange={() => onPickWinner(r.name)}
                    onClick={(e) => e.stopPropagation()}
                    className="size-3.5 shrink-0 accent-primary"
                  />
                )}
                <span className="truncate text-sm">{labelScenario(bet, r.name)}</span>
                {isWinner && (
                  <span className="shrink-0 rounded-full bg-success px-1.5 py-0.5 text-[10px] font-bold text-success-foreground">
                    Winner
                  </span>
                )}
              </span>
              <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Stake</span>
                <Input
                  className="h-8 w-20 text-right tabular-nums"
                  inputMode="decimal"
                  value={r.stake}
                  onChange={(e) => onUpdateRow(i, "stake", e.target.value)}
                />
              </label>
              <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Odds</span>
                <Input
                  className="h-8 w-20 text-right tabular-nums"
                  inputMode="decimal"
                  value={r.odds}
                  disabled={isLoss}
                  onChange={(e) => onUpdateRow(i, "odds", e.target.value)}
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm">
        <span>
          Total staked <strong>{fmt(preview.totalStaked)}</strong>
        </span>
        {!isLoss && (
          <span>
            Return <strong>{fmt(preview.returnAmount)}</strong>
          </span>
        )}
        <span className={preview.netProfit >= 0 ? "text-success" : "text-destructive"}>
          Net <strong>{fmt(preview.netProfit)}</strong>
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          onClick={onConfirm}
          className={cn(
            isLoss && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
        >
          {isLoss ? "Confirm loss" : "Confirm win"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "flex items-center gap-1 truncate text-sm font-semibold",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
        title={value}
      >
        {Icon && <Icon className="size-3.5 shrink-0" />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
