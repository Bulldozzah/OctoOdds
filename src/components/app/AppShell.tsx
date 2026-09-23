import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, User } from "lucide-react";
import { AppSidebar } from "@/components/app/AppSidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";

const SIDEBAR_KEY = "octoodds-sidebar-open";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === "0") setOpen(false);
    } catch {
      // Storage unavailable — default expanded.
    }
  }, []);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, o ? "0" : "1");
      } catch {
        // Non-persistent collapse is fine.
      }
      return !o;
    });
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Desktop: sticky collapsible sidebar (w-64 expanded / w-16 icon rail). */}
      <div className="relative hidden md:block">
        <AppSidebar open={open} onToggle={toggle} />
      </div>

      {/* Mobile: same sidebar as a slide-over drawer. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-navy/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0">
            <AppSidebar
              open
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src="/octoodds-logo.png" alt="OctoOdds" className="h-7 w-auto" />
          <span className="hidden text-xs text-muted-foreground sm:inline">Even the Odds</span>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/profile"
              aria-label="Profile"
              className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <User className="h-4 w-4" />
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
