// Cover-betting maths, ported verbatim from betmaster so both apps agree to
// the cent. See FUNCTIONAL-SPEC.md §3 and §10 for the derivations.

export type Outcome = "W" | "D" | "L";

export const OUTCOMES: Outcome[] = ["W", "D", "L"];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  W: "Win",
  D: "Draw",
  L: "Loss",
};
export const TEAM_LETTERS = ["A", "B", "C", "D"];
export const TEAM_TABS = [1, 2, 3, 4] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export interface Sport {
  id: string;
  label: string;
  /** What one participant is called in this sport. */
  side: string;
  icon: string;
}

// Head-to-head sports only (two sides per event) — the W/D/L scenario logic
// applies to all of them.
export const SPORTS: Sport[] = [
  { id: "football", label: "Football", side: "Team", icon: "⚽" },
  { id: "basketball", label: "Basketball", side: "Team", icon: "🏀" },
  { id: "tennis", label: "Tennis", side: "Player", icon: "🎾" },
  { id: "hockey", label: "Hockey", side: "Team", icon: "🏒" },
  { id: "cricket", label: "Cricket", side: "Team", icon: "🏏" },
  { id: "rugby", label: "Rugby", side: "Team", icon: "🏉" },
  { id: "american-football", label: "American Football", side: "Team", icon: "🏈" },
  { id: "volleyball", label: "Volleyball", side: "Team", icon: "🏐" },
  { id: "ufc", label: "UFC", side: "Fighter", icon: "🥋" },
  { id: "boxing", label: "Boxing", side: "Fighter", icon: "🥊" },
];

export interface Row {
  /** Canonical scenario name, e.g. "AW + BL". The ordering contract. */
  name: string;
  stake: string;
  odds: string;
  excluded?: boolean;
  /**
   * Marked as an outcome you don't expect. Turbo balancing stakes these for
   * capital return only and pushes everything left onto the rest. Ignored by
   * every other balancer. Optional so bets saved before it existed still load.
   */
  unlikely?: boolean;
}

export interface OutcomeOddsInput {
  W: string;
  D: string;
  L: string;
}

/**
 * Scenario names for n events, last event cycling fastest (base-3 counting).
 * Row i takes team t's outcome from OUTCOMES[floor(i / 3^(n-1-t)) % 3].
 */
export const buildScenarios = (numTeams: number): string[] => {
  const letters = TEAM_LETTERS.slice(0, numTeams);
  let combos: Outcome[][] = [[]];
  for (let t = 0; t < numTeams; t++) {
    const next: Outcome[][] = [];
    for (const combo of combos) {
      for (const outcome of OUTCOMES) next.push([...combo, outcome]);
    }
    combos = next;
  }
  return combos.map((outs) => outs.map((o, i) => letters[i] + o).join(" + "));
};

export const makeRows = (numTeams: number): Row[] =>
  buildScenarios(numTeams).map((name) => ({ name, stake: "0", odds: "0" }));

export const makeNames = (numTeams: number): string[] => Array.from({ length: numTeams }, () => "");

export const makeOutcomeOdds = (numTeams: number): OutcomeOddsInput[] =>
  Array.from({ length: numTeams }, () => ({ W: "", D: "", L: "" }));

/** Unparseable / empty input reads as 0 so typing never breaks the page. */
export const toNumber = (value: string | number | undefined | null): number => {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

export const fmt = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Plural-aware participant word: "Team" / "Teams", "Fighter" / "Fighters". */
export const sideWord = (sport: Sport, n: number): string =>
  n === 1 ? sport.side : `${sport.side}s`;

/**
 * Scenario odds = product of each event's outcome odds, for every row at once.
 * Row i takes team t's outcome from index floor(i / 3^(n-1-t)) % 3.
 */
export const deriveScenarioOdds = (
  outcomeOdds: OutcomeOddsInput[],
  numTeams: number,
  rowCount: number,
): string[] => {
  const out: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    let odds = 1;
    for (let t = 0; t < numTeams; t++) {
      const k = Math.floor(i / Math.pow(3, numTeams - 1 - t)) % 3;
      odds *= toNumber(outcomeOdds[t]?.[OUTCOMES[k]]);
    }
    out.push(String(Math.round(odds * 100) / 100));
  }
  return out;
};

export interface RowResult {
  gross: number;
  netPayout: number;
  profit: number;
  covered: boolean;
  /**
   * Extra stake needed to break even, tax included; null when the row is
   * already covered or can never cover (see the m > 1 test in computeRows).
   */
  minToCover: number | null;
  /** Whether minToCover fits inside the remaining budget. */
  affordable: boolean;
  profitPct: number;
}

export interface ComputeResult {
  totalStake: number;
  remaining: number;
  results: RowResult[];
}

/**
 * Per-row figures for the whole table.
 *   gross      = stake * odds
 *   netPayout  = gross - (gross - stake) * taxRate   (tax on winnings only)
 *   profit     = netPayout - total staked across ALL rows
 *   covered    = netPayout >= total staked
 *   minToCover = (total - stake * m) / (m - 1)       (m > 1 only)
 *
 * Both cover figures are stated in netPayout, not gross, because tax is paid
 * out of the return: a row whose gross clears the total can still hand back
 * less than it cost. Substituting gross = stake * odds into netPayout gives
 *
 *   netPayout = stake * (odds * (1 - taxRate) + taxRate) = stake * m
 *
 * — the same m that balanceProfitStakes and coverPlans dutch on, so every
 * figure on the screen now agrees about what a scenario actually returns.
 * Staking x more on a row moves both sides of the comparison (the row's
 * return AND the total it must clear), so break-even solves
 * (stake + x) * m >= total + x, giving the minToCover above. Using the
 * zero-tax form (total - gross) / (odds - 1) understates it whenever tax is
 * set, and the button that applies it leaves the row still losing.
 *
 * m > 1 is the coverable test: for any taxRate below 1 it is equivalent to
 * odds > 1, and at taxRate >= 1 nothing can ever cover, which it reports
 * instead of dividing by zero.
 */
export const computeRows = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): ComputeResult => {
  const taxRate = toNumber(tax);
  const budget = toNumber(targetStake);
  const total = rows.reduce((sum, row) => sum + toNumber(row.stake), 0);
  const remaining = budget - total;

  const results = rows.map((row) => {
    const stake = toNumber(row.stake);
    const odds = toNumber(row.odds);
    const gross = stake * odds;
    const taxAmount = (gross - stake) * taxRate;
    const netPayout = gross - taxAmount;
    const profit = netPayout - total;
    const covered = total <= netPayout;

    // Net return per unit staked, tax included: netPayout === stake * m.
    const m = odds * (1 - taxRate) + taxRate;

    let minToCover: number | null = null;
    let affordable = false;
    if (!covered && m > 1) {
      minToCover = (total - stake * m) / (m - 1);
      affordable = minToCover <= remaining;
    }

    // Percentage of the committed budget, not of gross — under Balance win
    // profit and gross scale together so their ratio would never move.
    const pctBase = budget > 0 ? budget : total;
    const profitPct = pctBase > 0 ? (profit / pctBase) * 100 : 0;

    return { gross, netPayout, profit, covered, minToCover, affordable, profitPct };
  });

  return { totalStake: total, remaining, results };
};

/** Rows eligible for staking: odds > 1 and not excluded by the user. */
export const stakeableIdx = (rows: Row[]): number[] =>
  rows.map((row, i) => (toNumber(row.odds) > 1 && !row.excluded ? i : -1)).filter((i) => i >= 0);

/**
 * Round to cents, then drop the whole rounding remainder on the largest stake
 * so the total is exactly T.
 */
export const roundStakes = (raw: number[], validIdx: number[], T: number): number[] => {
  const factor = 100;
  const stakes = raw.map((v) => Math.round(v * factor) / factor);
  let idxMax = -1;
  let max = -Infinity;
  validIdx.forEach((i) => {
    if (stakes[i] > max) {
      max = stakes[i];
      idxMax = i;
    }
  });
  if (idxMax >= 0) {
    const diff = Math.round((T - stakes.reduce((a, b) => a + b, 0)) * factor) / factor;
    stakes[idxMax] = Math.round((stakes[idxMax] + diff) * factor) / factor;
  }
  return stakes;
};

/**
 * Equal-profit dutching: stake_i proportional to 1/m_i where
 * m_i = odds*(1-tax) + tax, so every included scenario nets the same payout.
 * Returns null when there is nothing to stake.
 */
export const balanceProfitStakes = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): number[] | null => {
  const T = toNumber(targetStake);
  const taxRate = toNumber(tax);
  if (!(T > 0)) return null;

  const m = rows.map((row) => toNumber(row.odds) * (1 - taxRate) + taxRate);
  const validIdx = stakeableIdx(rows);
  if (validIdx.length === 0) return null;

  const sumInv = validIdx.reduce((a, i) => a + 1 / m[i], 0);
  const raw = rows.map(() => 0);
  validIdx.forEach((i) => {
    raw[i] = T / m[i] / sumInv;
  });
  return roundStakes(raw, validIdx, T);
};

export type TurboResult =
  | {
      ok: true;
      stakes: number[];
      /** How many scenarios were staked for capital return only. */
      floored: number;
      /** Smallest net return among them — at or just above the budget, never under. */
      recovered: number;
      /** What each remaining scenario returns once the rest of the budget lands on it. */
      likelyPayout: number;
      likelyProfit: number;
      likelyProfitPct: number;
      /** What plain Balance would return on every scenario, for comparison. */
      baselinePayout: number;
    }
  | { ok: false; message: string };

/**
 * Turbo balancing: give up profit on the outcomes you don't expect, and spend
 * what that frees on the ones you do.
 *
 * Scenarios ticked `unlikely` are staked to return exactly the budget — if one
 * lands you get your money back and nothing more. Everything left is dutched
 * across the rest for equal profit, so the outcomes you actually expect pay
 * more than an even Balance would.
 *
 * Writing m_i = odds_i(1-tax) + tax (so netPayout_i = stake_i * m_i), capital
 * return on scenario i costs T/m_i. The ticked set therefore consumes T*S_U
 * where S_U = Σ_{i∈U} 1/m_i, leaving R = T(1 - S_U) to dutch over the rest for
 * R/S_L each.
 *
 * Whether that beats plain Balance is not a matter of opinion:
 *
 *   R/S_L > T/(S_U + S_L)   <=>   S_U(1 - S_U - S_L) > 0   <=>   S < 1
 *
 * The likely side gains only when the whole included set already clears a
 * profit — the cover-all-but-one plans and the Scanner's arbs. On a normally
 * priced book (S > 1) every scenario returns less than the stake, so there is
 * no surplus to move: Turbo still delivers the capital guarantee, but the
 * likely scenarios pay for it. `baselinePayout` is returned precisely so the
 * caller can state which of the two happened instead of implying the first.
 *
 * Expected value barely moves either way — it is Σ p_i·stake_i·m_i, which at
 * zero tax is T/S however the stakes are arranged. This reshapes the payout
 * profile; it does not manufacture edge. What it is genuinely for is betting
 * your own read against the book's: if you think a price is longer than the
 * outcome deserves, this is how you stop paying full freight for it.
 */
export const turboBalanceStakes = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): TurboResult => {
  const T = toNumber(targetStake);
  const taxRate = toNumber(tax);
  if (!(T > 0)) return { ok: false, message: "Set a budget above 0 first." };

  /** Net return per unit staked, tax included — the same m computeRows uses. */
  const netMult = (row: Row): number => toNumber(row.odds) * (1 - taxRate) + taxRate;

  // m > 1 rather than odds > 1: identical below a 100% tax rate, and it keeps
  // a nonsense rate from producing stakes that divide by zero.
  const idx = stakeableIdx(rows).filter((i) => netMult(rows[i]) > 1);
  if (idx.length === 0) {
    return {
      ok: false,
      message: "No scenarios are eligible — check the odds and include at least one row.",
    };
  }

  const unlikely = idx.filter((i) => rows[i].unlikely);
  const likely = idx.filter((i) => !rows[i].unlikely);
  if (unlikely.length === 0) {
    return {
      ok: false,
      message: "Tick Unlikely on the scenarios you only want your stake back from.",
    };
  }
  if (likely.length === 0) {
    return {
      ok: false,
      message: "Leave at least one scenario unticked — that is where the freed stake goes.",
    };
  }

  const sumU = unlikely.reduce((a, i) => a + 1 / netMult(rows[i]), 0);
  if (!(sumU < 1)) {
    return {
      ok: false,
      message: `Returning the full ${fmt(T)} on those ${unlikely.length} scenarios would cost ${fmt(
        T * sumU,
      )} of a ${fmt(T)} budget, leaving nothing for the rest. Untick some, or tick ones priced longer.`,
    };
  }

  // Ticked scenarios round UP: the promise is "at least your stake back", so a
  // rounding cent has to fall on the safe side of it.
  const stakes = rows.map(() => 0);
  let spent = 0;
  unlikely.forEach((i) => {
    const s = Math.ceil((T / netMult(rows[i])) * 100) / 100;
    stakes[i] = s;
    spent += s;
  });

  const remaining = Math.round((T - spent) * 100) / 100;
  if (!(remaining > 0)) {
    return {
      ok: false,
      message: `Those scenarios use the whole ${fmt(T)} budget once rounded. Untick some.`,
    };
  }

  const sumL = likely.reduce((a, i) => a + 1 / netMult(rows[i]), 0);
  likely.forEach((i) => {
    stakes[i] = Math.round((remaining / (netMult(rows[i]) * sumL)) * 100) / 100;
  });

  // Drop the rounding remainder on the largest LIKELY stake — never on a ticked
  // one, whose exact figure is the guarantee being made.
  const iMax = likely.reduce((best, i) => (stakes[i] > stakes[best] ? i : best), likely[0]);
  const diff = Math.round((T - stakes.reduce((a, b) => a + b, 0)) * 100) / 100;
  stakes[iMax] = Math.round((stakes[iMax] + diff) * 100) / 100;

  const likelyPayout = remaining / sumL;
  return {
    ok: true,
    stakes,
    floored: unlikely.length,
    recovered: Math.min(...unlikely.map((i) => stakes[i] * netMult(rows[i]))),
    likelyPayout,
    likelyProfit: likelyPayout - T,
    likelyProfitPct: ((likelyPayout - T) / T) * 100,
    baselinePayout: T / (sumU + sumL),
  };
};

/** "AW + BD" -> "W+D" — the shorthand the give-up dropdown is labelled with. */
export const scenarioCode = (scenario: string): string =>
  scenario
    .split(" + ")
    .map((tok) => tok.slice(1))
    .join("+");

export interface CoverPlan {
  /** Row left unstaked, or null when every stakeable scenario is covered. */
  sacrifice: number | null;
  /** How many scenarios end up carrying a stake. */
  coveredCount: number;
  /** What each covered scenario nets, in currency. */
  profit: number;
  /** ...as a percentage of the budget, matching the table's Profit % column. */
  profitPct: number;
}

/**
 * What every choice of "which scenario do I give up" is worth, so the answer
 * can be compared before committing to one.
 *
 * Under equal-profit dutching over a covered set C, each covered scenario nets
 * T/S where S = Σ_{i∈C} 1/m_i and m_i = odds_i*(1-tax) + tax — so profit is
 * T/S - T and the only thing a sacrifice changes is dropping 1/m_k out of S.
 * Dropping the largest 1/m_k (the shortest-priced scenario, i.e. the
 * bookmaker's favourite) therefore buys the most profit, which is why the
 * best plan is so often the one you least want to give up.
 *
 * The Inc. checkboxes are deliberately ignored: picking a sacrifice is what
 * sets them. Rows priced at or below 1 can never be staked, so they are not
 * offered — giving one up costs nothing because it was already uncovered.
 */
export const coverPlans = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): CoverPlan[] => {
  const T = toNumber(targetStake);
  const taxRate = toNumber(tax);
  if (!(T > 0)) return [];

  const inv = new Map<number, number>();
  rows.forEach((row, i) => {
    const m = toNumber(row.odds) * (1 - taxRate) + taxRate;
    if (toNumber(row.odds) > 1 && m > 0) inv.set(i, 1 / m);
  });
  const pool = [...inv.keys()];
  if (pool.length === 0) return [];

  const sumAll = pool.reduce((a, i) => a + (inv.get(i) as number), 0);
  const plan = (sacrifice: number | null, S: number): CoverPlan => {
    const profit = T / S - T;
    return {
      sacrifice,
      coveredCount: pool.length - (sacrifice === null ? 0 : 1),
      profit,
      profitPct: (profit / T) * 100,
    };
  };

  const plans = [plan(null, sumAll)];
  // Giving up the only stakeable scenario would leave nothing to stake at all.
  if (pool.length > 1) {
    for (const i of pool) plans.push(plan(i, sumAll - (inv.get(i) as number)));
  }
  return plans;
};

/**
 * Rows restaked to the given plan: `sacrifice` is excluded and left on zero,
 * every other stakeable scenario shares the budget for equal profit. Returns
 * null when there is nothing to stake.
 */
export const applyCoverPlan = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
  sacrifice: number | null,
): Row[] | null => {
  const marked = rows.map((row, i) => ({
    ...row,
    excluded: sacrifice !== null && i === sacrifice,
  }));
  const stakes = balanceProfitStakes(marked, tax, targetStake);
  if (!stakes) return null;
  return marked.map((row, i) => ({ ...row, stake: String(stakes[i]) }));
};

export type BalanceWinResult =
  { ok: true; stakes: number[]; total: number; remaining: number } | { ok: false; message: string };

/**
 * Set every included scenario's gross return to `targetWin`:
 * stake_i = win / odds_i, rounded UP so each total win stays at or above
 * target. Refuses when the budget can't cover it.
 */
export const balanceWinStakes = (
  rows: Row[],
  targetStake: string | number,
  targetWin: string | number,
): BalanceWinResult => {
  const T = toNumber(targetStake);
  const W = toNumber(targetWin);
  if (!(W > 0)) {
    return { ok: false, message: "Enter a Total win amount greater than 0." };
  }

  const validIdx = stakeableIdx(rows);
  if (validIdx.length === 0) {
    return {
      ok: false,
      message: "No scenarios are eligible — check the odds and include at least one row.",
    };
  }

  const sumInvOdds = validIdx.reduce((a, i) => a + 1 / toNumber(rows[i].odds), 0);
  const needed = W * sumInvOdds;
  if (T > 0 && needed > T + 1e-9) {
    return {
      ok: false,
      message: `Can't balance: a ${fmt(W)} Total win needs ${fmt(needed)} total stake — max win for this budget is ${fmt(T / sumInvOdds)}.`,
    };
  }

  const factor = 100;
  const stakes = rows.map(() => 0);
  validIdx.forEach((i) => {
    stakes[i] = Math.ceil((W / toNumber(rows[i].odds)) * factor) / factor;
  });
  const total = stakes.reduce((a, b) => a + b, 0);
  return { ok: true, stakes, total, remaining: T - total };
};

/** "AW + BL" -> "Arsenal + Chelsea" (names line). */
export const scenarioTeams = (scenario: string, teamNames: string[]): string =>
  scenario
    .split(" + ")
    .map((tok) => {
      const idx = TEAM_LETTERS.indexOf(tok[0]);
      return teamNames[idx]?.trim() || tok[0];
    })
    .join(" + ");

/** "AW + BL" -> "W · L" (outcomes line). */
export const scenarioOutcomes = (scenario: string): string =>
  scenario
    .split(" + ")
    .map((tok) => tok.slice(1))
    .join(" · ");

/** "AW + BL" -> "Arsenal W + Chelsea L" (single line, for PDF and selects). */
export const labelScenario = (scenario: string, teamNames: string[]): string =>
  scenario
    .split(" + ")
    .map((tok) => {
      const letter = tok[0];
      const outcome = tok.slice(1);
      const idx = TEAM_LETTERS.indexOf(letter);
      const nm = teamNames[idx]?.trim();
      return `${nm || letter} ${outcome}`;
    })
    .join(" + ");
