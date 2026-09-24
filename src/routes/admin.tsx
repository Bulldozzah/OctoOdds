import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { addMonths } from "date-fns";
import { Check, Crown, Lock, LockOpen, ShieldCheck, User as UserIcon, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { useAuth } from "@/lib/auth";
import {
  supabase,
  hasPaidAccess,
  SUBSCRIPTION_PLANS,
  type Profile,
  type ProfileRole,
  type SubscriptionPlan,
} from "@/lib/supabase";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Members — OctoOdds" },
      {
        name: "description",
        content: "Manage subscriptions and roles: grant paid access, set super users and admins.",
      },
      { property: "og:title", content: "Members — OctoOdds" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminPage />
    </ProtectedRoute>
  );
}

const FILTERS = ["unpaid", "paid", "all"] as const;
type Filter = (typeof FILTERS)[number];

const ROLES: ProfileRole[] = ["user", "superuser", "admin"];

function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (loadError) setError(loadError.message);
    else {
      setError("");
      setProfiles((data ?? []) as Profile[]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (id: string, patch: Partial<Profile>) => {
    setBusyId(id);
    const { error: updateError } = await supabase.from("profiles").update(patch).eq("id", id);
    setBusyId(null);
    if (updateError) setError(updateError.message);
    else await load();
  };

  // Grant a paid subscription: flip is_paid on and set the period from now.
  const grant = (id: string, plan: SubscriptionPlan) => {
    const meta = SUBSCRIPTION_PLANS.find((p) => p.id === plan)!;
    const now = new Date();
    return patch(id, {
      is_paid: true,
      subscription_plan: plan,
      subscription_started_at: now.toISOString(),
      subscription_expires_at: addMonths(now, meta.months).toISOString(),
    });
  };

  const revoke = (id: string) => patch(id, { is_paid: false, subscription_expires_at: null });

  const visible = profiles.filter((p) => {
    if (filter === "all") return true;
    const paid = hasPaidAccess(p);
    return filter === "paid" ? paid : !paid;
  });

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
              <ShieldCheck className="size-6 text-primary" />
              Members
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Grant paid access, set super users, and manage roles.
            </p>
          </div>

          <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  filter === f ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <PaywallCard />

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-card">
            <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No users in “{filter}”.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {visible.map((p) => (
              <MemberRow
                key={p.id}
                profile={p}
                busy={busyId === p.id}
                onGrant={(plan) => void grant(p.id, plan)}
                onRevoke={() => void revoke(p.id)}
                onSetRole={(role) => void patch(p.id, { role })}
              />
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

function MemberRow({
  profile: p,
  busy,
  onGrant,
  onRevoke,
  onSetRole,
}: {
  profile: Profile;
  busy: boolean;
  onGrant: (plan: SubscriptionPlan) => void;
  onRevoke: () => void;
  onSetRole: (role: ProfileRole) => void;
}) {
  const paid = hasPaidAccess(p);
  const noPayNeeded = p.role === "admin" || p.role === "superuser";

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-sky text-sm font-bold text-primary-foreground">
            {(p.full_name || p.email || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="truncate">{p.full_name || "(no name)"}</strong>
              <RoleBadge role={p.role} />
              <AccessBadge paid={paid} noPayNeeded={noPayNeeded} />
            </div>
            <div className="truncate text-sm text-muted-foreground">{p.email}</div>
            <div className="text-xs text-muted-foreground">
              {p.subscription_plan && (
                <>
                  {SUBSCRIPTION_PLANS.find((s) => s.id === p.subscription_plan)?.name} plan
                  {p.subscription_expires_at && ` · expires ${formatDate(p.subscription_expires_at)}`}
                  {" · "}
                </>
              )}
              Registered {formatDate(p.created_at)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">Role</label>
          <select
            value={p.role}
            disabled={busy}
            onChange={(e) => onSetRole(e.target.value as ProfileRole)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm capitalize"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Paid access only matters for regular users — admins/superusers are free. */}
      {p.role === "user" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            {paid ? "Extend / change:" : "Grant access:"}
          </span>
          {SUBSCRIPTION_PLANS.map((plan) => (
            <Button
              key={plan.id}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onGrant(plan.id)}
            >
              <Check className="size-4" /> {plan.name}
            </Button>
          ))}
          {paid && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={onRevoke}
            >
              <X className="size-4" /> Revoke
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Global paywall switch. Free-access mode lets every signed-in user in; paid
 * status on profiles is never touched, so turning the paywall back on restores
 * exactly who had paid before.
 */
function PaywallCard() {
  const { user, paywallEnabled, refreshSettings } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const freeMode = !paywallEnabled;

  const apply = async () => {
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase
      .from("app_settings")
      .update({
        bool_value: !paywallEnabled,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("key", "paywall_enabled");
    setBusy(false);
    if (updateError) setError(updateError.message);
    else await refreshSettings();
  };

  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-card",
        freeMode &&
          "border-destructive/60 shadow-[0_0_28px_-4px_var(--color-destructive)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg",
            freeMode ? "bg-destructive/15 text-destructive" : "bg-sky-soft text-primary",
          )}
        >
          {freeMode ? <LockOpen className="size-5" /> : <Lock className="size-5" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong>Site access</strong>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-bold",
                freeMode ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success",
              )}
            >
              {freeMode ? "Free access — paywall OFF" : "Payment required"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {freeMode
              ? "Everyone who signs in can use the app without paying."
              : "Unpaid users are sent to the payment page. Members who paid keep access."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {freeMode ? "Paywall off" : "Paywall on"}
        </span>
        <Switch
          checked={paywallEnabled}
          disabled={busy}
          onCheckedChange={() => setConfirmOpen(true)}
          className={cn(freeMode && "shadow-[0_0_12px_2px_var(--color-destructive)]")}
          aria-label="Toggle paywall"
        />
      </div>

      {error && (
        <Alert tone="error" className="w-full">
          {error}
        </Alert>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {freeMode ? "Re-enable the paywall?" : "Enable free access for everyone?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {freeMode
                ? "Unpaid users will be sent to the payment page. Members who already paid keep their access — paid status is stored on each profile and is never wiped by this switch."
                : "Every registered user will be able to use the whole app without paying — useful for launch promos and free trials. You can switch the paywall back on here at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void apply()}
              className={cn(freeMode ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {freeMode ? "Yes, enable paywall" : "Yes, free access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleBadge({ role }: { role: ProfileRole }) {
  if (role === "admin")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2 py-0.5 text-xs font-bold text-sky-deep">
        <ShieldCheck className="size-3" /> admin
      </span>
    );
  if (role === "superuser")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2 py-0.5 text-xs font-bold text-sky-deep">
        <Crown className="size-3" /> super user
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
      <UserIcon className="size-3" /> user
    </span>
  );
}

function AccessBadge({ paid, noPayNeeded }: { paid: boolean; noPayNeeded: boolean }) {
  if (noPayNeeded)
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-success">
        free access
      </span>
    );
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold",
        paid ? "bg-success/15 text-success" : "bg-warning/20 text-warning-foreground",
      )}
    >
      {paid ? "paid" : "unpaid"}
    </span>
  );
}
