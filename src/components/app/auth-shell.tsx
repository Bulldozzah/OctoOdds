// Shared chrome for the signed-out pages (sign in, register, reset password,
// awaiting approval) so they read as one flow rather than four screens.

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-sky text-primary-foreground shadow-glow">
            <Calculator className="size-4" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">OctoOdds</span>
        </Link>
        <span className="text-sm text-muted-foreground">Even the Odds</span>
      </header>

      <main className="mx-auto px-4 pb-16 pt-6">
        <section
          className={cn(
            "mx-auto rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </section>
      </main>
    </div>
  );
}

const TONES = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-sky-soft/60 text-accent-foreground",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/50 bg-warning/15 text-warning-foreground",
} as const;

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn("rounded-xl border px-3 py-2 text-sm", TONES[tone], className)}
    >
      {children}
    </div>
  );
}
