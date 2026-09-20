import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <SidebarInset className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border bg-card/90 px-3 backdrop-blur">
            <SidebarTrigger />
            <img src="/octoodds-logo.png" alt="OctoOdds" className="h-6 w-auto" />
            <span className="hidden text-xs text-muted-foreground sm:inline">Even the Odds</span>
          </header>
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
