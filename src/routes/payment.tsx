import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import PricingSection from "@/components/ui/pricing-section";
import { RouteSpinner } from "@/components/app/protected-route";
import { Alert } from "@/components/app/auth-shell";
import { useAuth } from "@/lib/auth";
import { supabase, SUBSCRIPTION_PLANS, type SubscriptionPlan } from "@/lib/supabase";

export const Route = createFileRoute("/payment")({
  head: () => ({
    meta: [
      { title: "Choose a plan — OctoOdds" },
      {
        name: "description",
        content: "Pick an OctoOdds subscription to unlock the calculator, scanner and bet tracker.",
      },
      { property: "og:title", content: "Choose a plan — OctoOdds" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PaymentPage,
});

function PaymentPage() {
  const { user, profile, loading, hasAccess, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [busyPlan, setBusyPlan] = useState<SubscriptionPlan | null>(null);
  const [error, setError] = useState("");

  // Signed-out users belong on the sign-in page; users who already have access
  // (admins, superusers, paid members) never need this screen.
  useEffect(() => {
    if (loading) return;
    if (!user) void navigate({ to: "/", replace: true });
    else if (hasAccess) void navigate({ to: "/calculator", replace: true });
  }, [loading, user, hasAccess, navigate]);

  if (loading || !user || hasAccess) return <RouteSpinner />;

  const selectedPlan = profile?.subscription_plan ?? null;
  const selectedMeta = SUBSCRIPTION_PLANS.find((p) => p.id === selectedPlan);

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (!user) return;
    setBusyPlan(plan);
    setError("");
    // Record the choice on the profile. Access itself is unlocked separately by
    // flipping is_paid in Supabase (or on the /admin screen) once payment lands.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ subscription_plan: plan })
      .eq("id", user.id);
    setBusyPlan(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="flex items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <img src="/octoodds-logo.png" alt="OctoOdds" className="h-7 w-auto" />
          <span className="hidden text-sm text-muted-foreground sm:inline">Even the Odds</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => void refreshProfile()}
            className="font-medium text-primary hover:underline"
          >
            Refresh status
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await signOut();
                void navigate({ to: "/", replace: true });
              })();
            }}
            className="text-muted-foreground hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <p className="pt-2 text-center text-sm text-muted-foreground">
          Hi {profile?.full_name || user.email} — your account is active but not yet unlocked.
        </p>

        {error && (
          <Alert tone="error" className="mx-auto mt-4 max-w-xl">
            {error}
          </Alert>
        )}

        {selectedMeta && (
          <Alert tone="info" className="mx-auto mt-4 max-w-xl">
            <span className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                You picked the <strong>{selectedMeta.name}</strong> plan (${selectedMeta.price}).
                Complete your payment, then use <strong>Refresh status</strong> — access unlocks
                once it&apos;s confirmed.
              </span>
            </span>
          </Alert>
        )}
      </div>

      <PricingSection
        onSelectPlan={(plan) => void handleSelectPlan(plan)}
        busyPlan={busyPlan}
        selectedPlan={selectedPlan}
      />
    </div>
  );
}
