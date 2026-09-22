import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarDays, LogOut, Mail, ShieldCheck, Ticket, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { Button } from "@/components/ui/button";
import { supabase, SUBSCRIPTION_PLANS, type Bet } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { computeBet, fmt } from "@/lib/bet-stats";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Your OctoOdds Account" },
      {
        name: "description",
        content:
          "View your OctoOdds account details, approval status and saved bet totals, and sign out of the session.",
      },
      { property: "og:title", content: "Profile — Your OctoOdds Account" },
      { property: "og:description", content: "Account details and saved plan totals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfileRoute,
});

function ProfileRoute() {
  return (
    <ProtectedRoute>
      <ProfilePage />
    </ProtectedRoute>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-sky-soft p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className={cn("mt-1 font-display text-2xl font-bold", tone)}>{value}</p>
    </div>
  );
}

function ProfilePage() {
  const { user, profile, isAdmin, isSuperuser, hasAccess, signOut } = useAuth();
  const navigate = useNavigate();
  const [bets, setBets] = useState<Bet[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data, error: loadError } = await supabase.from("bets").select("*");
      if (loadError) setError(loadError.message);
      else setBets((data ?? []) as Bet[]);
    };
    void load();
  }, []);

  const computed = bets.map(computeBet);
  const staked = computed.reduce((s, c) => s + c.totalStaked, 0);
  const settled = computed.filter((c) => c.settled);
  const net = settled.reduce((s, c) => s + c.netProfit, 0);
  const pending = computed.length - settled.length;

  const displayName = profile?.full_name || user?.email || "Account";
  const roleLabel = isAdmin
    ? "Administrator"
    : isSuperuser
      ? "Super user"
      : hasAccess
        ? "Member"
        : "Payment required";

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="font-display text-3xl font-bold">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account details and saved bet totals.
        </p>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-sky text-xl font-bold text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-semibold">{displayName}</p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="size-3.5" /> {user?.email ?? "—"}
              </p>
            </div>
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
                isAdmin || isSuperuser
                  ? "bg-sky-soft text-sky-deep"
                  : hasAccess
                    ? "bg-success/15 text-success"
                    : "bg-warning/20 text-warning-foreground",
              )}
            >
              <ShieldCheck className="size-3.5" /> {roleLabel}
            </span>
          </div>

          {profile?.created_at && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" /> Member since {formatDate(profile.created_at)}
            </p>
          )}

          {!isAdmin && !isSuperuser && profile?.subscription_plan && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              {SUBSCRIPTION_PLANS.find((p) => p.id === profile.subscription_plan)?.name ??
                profile.subscription_plan}{" "}
              plan
              {profile.subscription_expires_at
                ? ` · renews ${formatDate(profile.subscription_expires_at)}`
                : ""}
            </p>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile icon={Ticket} label="Saved bets" value={String(bets.length)} />
            <Tile icon={Ticket} label="Pending" value={String(pending)} />
            <Tile icon={TrendingUp} label="Total staked" value={fmt(staked)} />
            <Tile
              icon={TrendingUp}
              label="Net (settled)"
              value={fmt(net)}
              tone={net >= 0 ? "text-odds-up" : "text-odds-down"}
            />
          </div>

          <Button
            variant="outline"
            className="mt-6"
            onClick={() => {
              void (async () => {
                await signOut();
                void navigate({ to: "/", replace: true });
              })();
            }}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </main>
    </AppShell>
  );
}
