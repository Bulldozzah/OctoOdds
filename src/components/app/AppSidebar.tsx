import { useNavigate, useRouterState } from "@tanstack/react-router";
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
import {
  DashboardSidebar,
  SidebarOption,
  SidebarSection,
  SidebarTitleSection,
  SidebarToggleClose,
} from "@/components/ui/dashboard-with-collapsible-sidebar";
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

export function AppSidebar({
  open,
  onToggle,
  onNavigate,
}: {
  open: boolean;
  onToggle: () => void;
  /** Called after any nav/sign-out click — lets the mobile drawer close. */
  onNavigate?: () => void;
}) {
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
    <DashboardSidebar open={open}>
      <SidebarTitleSection open={open} title={displayName} subtitle={roleLabel} />

      <div className="mb-8 space-y-1">
        {visible.map((item) => (
          <SidebarOption
            key={item.title}
            icon={item.icon}
            title={item.title}
            to={item.url}
            selected={pathname === item.url}
            open={open}
            onClick={onNavigate}
          />
        ))}
      </div>

      <div className="mt-auto">
        <SidebarSection open={open} label="Account">
          <SidebarOption
            icon={LogOut}
            title="Sign out"
            open={open}
            onClick={() => {
              void (async () => {
                await signOut();
                onNavigate?.();
                void navigate({ to: "/", replace: true });
              })();
            }}
          />
        </SidebarSection>
      </div>

      <SidebarToggleClose open={open} onToggle={onToggle} />
    </DashboardSidebar>
  );
}
