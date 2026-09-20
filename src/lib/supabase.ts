import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

// This app is server-rendered, so this module is evaluated on the server too,
// where there is no localStorage and no session. Session persistence is
// therefore browser-only: on the server the client stays anonymous and every
// auth-dependent screen renders its loading state until the browser takes over.
const isBrowser = typeof window !== "undefined";

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});

export type ProfileStatus = "pending" | "approved" | "rejected";
export type ProfileRole = "user" | "admin" | "superuser";

/** Subscription lengths a paying user can choose on the payment page. */
export type SubscriptionPlan = "monthly" | "biannual" | "annual";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  /** @deprecated Legacy approval flag — access is now governed by paid status. */
  status: ProfileStatus;
  /** @deprecated Legacy proof-of-payment upload from the old approval flow. */
  payment_proof_url: string | null;
  /** Manual switch — flip in Supabase (or /admin) to unlock a paying user. */
  is_paid: boolean;
  /** The plan the user last selected on the payment page (informational). */
  subscription_plan: SubscriptionPlan | null;
  subscription_started_at: string | null;
  /** Access lapses once this is in the past; null means an indefinite grant. */
  subscription_expires_at: string | null;
  created_at: string;
}

/** How each plan maps to a price and length. Prices are in USD. */
export const SUBSCRIPTION_PLANS: {
  id: SubscriptionPlan;
  name: string;
  months: number;
  price: number;
  /** Savings versus paying the monthly rate for the whole period, in USD. */
  savings: number;
  popular?: boolean;
}[] = [
  { id: "monthly", name: "1 Month", months: 1, price: 5, savings: 0 },
  { id: "biannual", name: "6 Months", months: 6, price: 25, savings: 5, popular: true },
  { id: "annual", name: "1 Year", months: 12, price: 50, savings: 10 },
];

/**
 * Whether a profile may use the app. Admins and superusers never pay; a
 * regular user needs an active paid subscription (is_paid, and not expired).
 */
export function hasPaidAccess(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "superuser") return true;
  if (!profile.is_paid) return false;
  if (!profile.subscription_expires_at) return true;
  return new Date(profile.subscription_expires_at).getTime() > Date.now();
}

// Scenario row as stored on a saved bet. `name` is the canonical "AW + BL"
// form — the ordering contract every screen indexes off.
export interface BetRow {
  name: string;
  stake: string;
  odds: string;
  excluded?: boolean;
}

export interface OutcomeOdds {
  W: string;
  D: string;
  L: string;
}

export interface BetGame {
  home: string;
  away: string;
  league?: string;
}

/**
 * Everything the Calculator needs to restore a bet. Both a saved row from the
 * database and a fresh pick handed over by the Scanner satisfy this.
 */
export interface LoadableBet {
  title: string;
  team_count: number;
  tax: number;
  target_stake: number;
  rows: BetRow[];
  team_names: string[];
  outcome_odds?: OutcomeOdds[] | null;
  games?: BetGame[] | null;
}

/** A bet as persisted in the `bets` table. */
export interface Bet extends LoadableBet {
  id: string;
  user_id: string;
  won_scenario: string | null;
  settled_at: string | null;
  created_at: string;
}
