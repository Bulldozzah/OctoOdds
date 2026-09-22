import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Calculator,
  Gauge,
  LogOut,
  Radar,
  ShieldCheck,
  Ticket,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

const items = [
  { title: "Calculator", url: "/calculator", icon: Calculator },
  { title: "Scanner", url: "/scanner", icon: Radar },
  { title: "Edge", url: "/edge", icon: Gauge },
  { title: "My bets", url: "/my-bets", icon: Ticket },
  { title: "Stats", url: "/stats", icon: BarChart3 },
  { title: "Profile", url: "/profile", icon: User },
  // Only rendered for administrators — see `visible` below.
  { title: "Admin", url: "/admin", icon: ShieldCheck, adminOnly: true },
] as const;

/** Up to two initials from the display name, e.g. "Abel Chilungu" -> "AC". */
const initialsOf = (source: string) =>
  source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("") || "?";

export function AppSidebar() {
  const { user, profile, isAdmin, isSuperuser, hasAccess, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const displayName = profile?.full_name || user?.email || "Guest";
  const roleLabel = !user
    ? "Signed out"
    : isAdmin
      ? "Administrator"
      : isSuperuser
        ? "Super user"
        : hasAccess
          ? "Member"
          : "Payment required";

  // Hiding the link is presentation only — /admin is guarded by ProtectedRoute
  // and by row-level security on the profiles table.
  const visible = items.filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-1 py-1.5">
          {/* Collapsed to icons: the wordmark won't fit, so crop to the octopus. */}
          <span className="hidden size-8 shrink-0 place-items-center overflow-hidden rounded-lg group-data-[collapsible=icon]:grid">
            <img
              src="/octoodds-logo.png"
              alt=""
              aria-hidden="true"
              className="size-full scale-[1.9] object-contain"
            />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
            <img src="/octoodds-logo.png" alt="OctoOdds" className="h-8 w-auto self-start" />
            <span className="text-[11px] leading-tight text-muted-foreground">Even the Odds</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-lg border border-sidebar-border p-2 group-data-[collapsible=icon]:hidden">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-soft text-xs font-semibold">
            {initialsOf(displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start group-data-[collapsible=icon]:justify-center"
          onClick={() => {
            void (async () => {
              await signOut();
              void navigate({ to: "/", replace: true });
            })();
          }}
        >
          <LogOut className="size-4" />
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
        </Button>
      </SidebarFooter>
      {/* Click the sidebar's right edge to collapse/expand — keeps the
          expandable behaviour available outside the header trigger too. */}
      <SidebarRail />
    </Sidebar>
  );
}
