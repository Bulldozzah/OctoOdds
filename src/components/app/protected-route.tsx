import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * Gates a page by auth state, approval status and (optionally) admin role.
 *
 *   1. still loading            -> spinner, decide nothing
 *   2. no signed-in user        -> /
 *   3. needs admin, isn't admin -> /calculator
 *   4. no paid access           -> /payment
 *
 * The redirect runs in an effect rather than during render because this app is
 * server-rendered: on the server there is no session, so rendering a redirect
 * would bounce every visitor to the sign-in page before the browser can restore
 * theirs.
 */
export function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, profile, loading, profileError, isAdmin, hasAccess, refreshProfile, signOut } =
    useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/", replace: true });
      return;
    }
    if (requireAdmin && !isAdmin) {
      void navigate({ to: "/calculator", replace: true });
      return;
    }
    // Profile may briefly be null right after sign-in; only redirect once it
    // has actually loaded and says the user hasn't paid.
    if (!requireAdmin && profile && !hasAccess) {
      void navigate({ to: "/payment", replace: true });
    }
  }, [loading, user, profile, isAdmin, hasAccess, requireAdmin, navigate]);

  if (loading) return <RouteSpinner />;
  // Redirecting to the sign-in page.
  if (!user) return <RouteSpinner />;
  // Redirecting to /calculator.
  if (requireAdmin && !isAdmin) return <RouteSpinner />;

  // The profile lookup failed for a recoverable reason. Without this the page
  // would spin forever waiting for a profile that is never going to arrive.
  if (profileError) {
    return (
      <ProfileProblem
        message={profileError}
        onRetry={() => void refreshProfile()}
        onSignOut={() => void signOut()}
      />
    );
  }

  // Signed in, no error, profile still in flight — genuinely transient.
  if (!profile) return <RouteSpinner />;
  // Redirecting to /payment.
  if (!requireAdmin && !hasAccess) return <RouteSpinner />;

  return <>{children}</>;
}

export function RouteSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-soft">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading…
      </div>
    </div>
  );
}

function ProfileProblem({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-soft px-4">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-lift">
        <h1 className="font-display text-lg font-bold">Couldn&apos;t load your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We signed you in, but your profile didn&apos;t load.
        </p>
        <p className="mt-3 break-words rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {message}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
