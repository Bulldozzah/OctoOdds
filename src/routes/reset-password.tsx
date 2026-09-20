import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, Alert } from "@/components/app/auth-shell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — OctoOdds" },
      { name: "description", content: "Reset your OctoOdds password." },
      { property: "og:title", content: "Reset password — OctoOdds" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"request" | "update">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Arriving via the recovery email fires PASSWORD_RECOVERY and establishes a
  // temporary session — that's the cue to show the "set new password" form.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setBusy(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (resetError) setError(resetError.message);
    else setMsg("Password reset link sent. Check your email.");
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMsg("Password updated. Redirecting to sign in…");
      setTimeout(() => void navigate({ to: "/", replace: true }), 1500);
    }
  };

  return (
    <AuthShell
      title={mode === "request" ? "Reset password" : "Set new password"}
      subtitle={
        mode === "request"
          ? "We'll email you a link to choose a new one."
          : "Pick a new password for your account."
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {msg && (
        <Alert tone="success" className="mb-4">
          {msg}
        </Alert>
      )}

      <form
        onSubmit={(e) => void (mode === "request" ? sendReset(e) : updatePassword(e))}
        className="space-y-4"
      >
        {mode === "request" ? (
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="New password (6+ characters)"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Working…" : mode === "request" ? "Send reset link" : "Update password"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
