import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, Alert } from "@/components/app/auth-shell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — OctoOdds" },
      {
        name: "description",
        content: "Register to request access to the OctoOdds calculator and odds scanner.",
      },
      { property: "og:title", content: "Create account — OctoOdds" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
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
    else setDone(true);
  };

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            Confirm your email, then sign in to continue.
          </>
        }
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Register to request access to the calculator.">
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Full name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

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

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Password (6+ characters)"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
