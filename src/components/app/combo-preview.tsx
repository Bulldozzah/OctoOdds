// Read-only preview of a scanned combo, shared by the Scanner and the Test
// workbench so both show the same figures in the same shape.
//
// Built on the shadcn Dialog rather than a hand-rolled overlay, so it gets
// focus trapping, Escape-to-close and scroll locking for free.

import { useMemo, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildComboBet, type ComboResult } from "@/lib/scanner";
import { computeRows, fmt, TEAM_LETTERS, type Row } from "@/lib/calculator";
import { eventExposures, openBetClashes, type OpenBet } from "@/lib/exposure";
import { ExposureWarning } from "@/components/app/exposure-warning";

/** 3-letter uppercase abbreviation, e.g. "Arsenal" -> "ARS". */
const abbr = (name: string, fallback: string): string =>
  (name?.trim() ? name.trim().slice(0, 3) : fallback).toUpperCase();

const OUTCOME_TONE: Record<string, string> = {
  W: "bg-success/15 text-success",
  D: "bg-secondary text-secondary-foreground",
  L: "bg-destructive/15 text-destructive",
};

/**
 * Compact read-only preview of a scanned combo: each game's W/D/L odds up top,
 * then every scenario with its 3-letter names, total win, profit % and cover
 * status — the same figures the Calculator would show at a 100 budget.
 *
 * `extra` lets a caller add a row of its own figures under the header without
 * this component having to know about them. `openBets` enables the correlation
 * warning — pass the unsettled bets and any fixture already staked is named
 * here, before the combo can be loaded.
 */
export function ComboPreviewModal({
  result,
  onClose,
  onLoad,
  extra,
  openBets,
}: {
  result: ComboResult | null;
  onClose: () => void;
  onLoad: () => void;
  extra?: ReactNode;
  openBets?: OpenBet[];
}) {
  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        {result && (
          <PreviewBody
            result={result}
            onClose={onClose}
            onLoad={onLoad}
            extra={extra}
            openBets={openBets}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  result,
  onClose,
  onLoad,
  extra,
  openBets,
}: {
  result: ComboResult;
  onClose: () => void;
  onLoad: () => void;
  extra?: ReactNode;
  openBets?: OpenBet[];
}) {
  const bet = useMemo(() => buildComboBet(result), [result]);
  const rows = bet.rows as Row[];
  const { totalStake, results } = useMemo(
    () => computeRows(rows, bet.tax, bet.target_stake),
    [rows, bet.tax, bet.target_stake],
  );
  const names = bet.team_names ?? [];
  const tag = (letter: string) => abbr(names[TEAM_LETTERS.indexOf(letter)] ?? "", letter);

  const clashes = useMemo(
    () =>
      openBets?.length
        ? openBetClashes(eventExposures(result.games, null, result.games.length), openBets)
        : [],
    [openBets, result.games],
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Scenario preview</DialogTitle>
        <DialogDescription>
          At a {fmt(totalStake)} budget · via {result.bookLabel}
        </DialogDescription>
      </DialogHeader>

      {extra}

      {clashes.length > 0 && <ExposureWarning clashes={clashes} compact />}

      {/* Teams & odds */}
      <div className="space-y-1.5">
        {result.games.map((g, i) => {
          const o = result.gamesOdds[i];
          return (
            <div
              key={g.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                <span className="mr-1 font-mono font-bold text-primary">
                  {abbr(g.home, TEAM_LETTERS[i])}
                </span>
                {g.home} <span className="text-muted-foreground">v</span> {g.away}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                W {fmt(o.W)} · D {fmt(o.D)} · L {fmt(o.L)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scenario grid */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-sky-soft/60 uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Scenario</th>
              <th className="p-2 text-right">Total win</th>
              <th className="p-2 text-right">Profit %</th>
              <th className="p-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const r = results[i];
              return (
                <tr
                  key={row.name}
                  className={cn("border-t border-border", row.excluded && "opacity-40")}
                >
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {row.name.split(" + ").map((tok) => (
                        <span
                          key={tok}
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono font-semibold",
                            OUTCOME_TONE[tok.slice(1)],
                          )}
                        >
                          {tag(tok[0])} {tok.slice(1)}
                        </span>
                      ))}
                      {row.excluded && (
                        <span className="rounded bg-warning/20 px-1.5 py-0.5 font-semibold text-warning-foreground">
                          excluded
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-right font-mono">{fmt(r.gross)}</td>
                  <td
                    className={cn(
                      "p-2 text-right font-mono",
                      r.profit >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {r.gross > 0 ? `${r.profitPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="p-2 text-center">
                    <span
                      title={r.covered ? "Covered" : "Loss"}
                      className={cn(
                        "text-sm font-bold",
                        r.covered ? "text-success" : "text-destructive",
                      )}
                    >
                      {r.covered ? "▲" : "▼"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onLoad}>
          Load into Calculator <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </>
  );
}
