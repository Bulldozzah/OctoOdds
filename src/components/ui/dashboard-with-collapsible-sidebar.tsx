import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Collapsible dashboard sidebar primitives.
 * Sticky full-height nav that animates between w-64 (expanded) and w-16
 * (icon rail), with a bottom edge toggle. Styled on the app's semantic
 * sidebar/sky tokens so it follows the OctoOdds theme in light and dark.
 */

export function DashboardSidebar({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "sticky top-0 flex h-svh shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-2 pb-16 shadow-sm transition-[width] duration-300 ease-in-out",
        open ? "w-64" : "w-16",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function SidebarTitleSection({
  open,
  title,
  subtitle,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6 border-b border-sidebar-border pb-4">
      <div className="flex cursor-default items-center justify-between rounded-md p-2 transition-colors hover:bg-sidebar-accent/60">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-content-center overflow-hidden rounded-lg bg-gradient-sky shadow-sm">
            <img
              src="/octoodds-logo.png"
              alt=""
              aria-hidden="true"
              className="size-7 scale-[1.9] object-contain"
            />
          </div>
          {open && (
            <div className="min-w-0 transition-opacity duration-200">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {title}
              </span>
              {subtitle && (
                <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
              )}
            </div>
          )}
        </div>
        {open && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
    </div>
  );
}

export function SidebarOption({
  icon: Icon,
  title,
  to,
  selected,
  open,
  notifs,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** TanStack Router path. Omit to render a plain button (e.g. sign out). */
  to?: ComponentProps<typeof Link>["to"];
  selected?: boolean;
  open: boolean;
  notifs?: number;
  onClick?: () => void;
}) {
  const className = cn(
    "relative flex h-11 w-full items-center rounded-md transition-all duration-200",
    selected
      ? "border-l-2 border-sidebar-primary bg-sky-soft text-sidebar-primary shadow-sm"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );
  const inner = (
    <>
      <div className="grid h-full w-12 shrink-0 place-content-center">
        <Icon className="h-4 w-4" />
      </div>
      {open && (
        <span className="truncate text-sm font-medium transition-opacity duration-200">
          {title}
        </span>
      )}
      {notifs !== undefined && open && (
        <span className="absolute right-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground">
          {notifs}
        </span>
      )}
    </>
  );

  return to ? (
    <Link to={to} onClick={onClick} className={className} title={open ? undefined : title}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className} title={open ? undefined : title}>
      {inner}
    </button>
  );
}

/** Labelled section divider — the demo's "Account" group above the fold. */
export function SidebarSection({
  open,
  label,
  children,
}: {
  open: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1 border-t border-sidebar-border pt-4">
      {open && (
        <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

export function SidebarToggleClose({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute bottom-0 left-0 right-0 border-t border-sidebar-border bg-sidebar transition-colors hover:bg-sidebar-accent"
    >
      <div className="flex items-center p-3">
        <div className="grid size-10 shrink-0 place-content-center">
          <ChevronsRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-300",
              open && "rotate-180",
            )}
          />
        </div>
        {open && (
          <span className="text-sm font-medium text-sidebar-foreground/80 transition-opacity duration-200">
            Hide
          </span>
        )}
      </div>
    </button>
  );
}
