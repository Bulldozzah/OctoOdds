import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthSwitch, type SignInValues, type SignUpValues } from "@/components/ui/auth-switch";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OctoOdds — Even the Odds | Cover Betting Calculator & Odds Scanner" },
      {
        name: "description",
        content:
          "Split any budget across every outcome of up to four events, scan live bookmaker odds for profitable cover combinations, and track every bet you place.",
      },
      { property: "og:title", content: "OctoOdds — Even the Odds" },
      {
        property: "og:description",
        content:
          "Plan cover bets across 3, 9, 27 or 81 scenarios with instant profit, tax and min-to-cover maths.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const { user, hasAccess, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the form. Users with access land on the Calculator,
  // everyone else on the payment screen.
  useEffect(() => {
    if (loading || !user) return;
    void navigate({ to: hasAccess ? "/calculator" : "/payment", replace: true });
  }, [loading, user, hasAccess, navigate]);

  const handleSignIn = async ({ email, password }: SignInValues) => {
    setError("");
    setNotice("");
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    // The auth listener refreshes the profile; the effect above then routes to
    // /calculator or /payment depending on paid access.
    void navigate({ to: "/calculator", replace: true });
  };

  const handleSignUp = async ({ fullName, email, password }: SignUpValues) => {
    setError("");
    setNotice("");
    setBusy(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored on the auth user; the profiles row picks it up.
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    setBusy(false);
    if (signUpError) setError(signUpError.message);
    else setNotice(`We sent a confirmation link to ${email}. Confirm it, then sign in.`);
  };

  return (
    <AuthSwitch
      onSignIn={(values) => void handleSignIn(values)}
      onSignUp={(values) => void handleSignUp(values)}
      busy={busy}
      error={error}
      notice={notice}
      forgotPassword={<Link to="/reset-password">Forgot password?</Link>}
    />
  );
}
