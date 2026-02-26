// ═══════════════════════════════════════════════════════════════
// NexusX — Top Bar
// apps/web/src/components/layout/TopBar.tsx
//
// Contextual breadcrumb bar + quick actions for seamless navigation.
// ═══════════════════════════════════════════════════════════════

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  href?: string;
}

const ROUTE_MAP: Record<string, { label: string; section: string }> = {
  "/marketplace": { label: "Market", section: "Marketplace" },
  "/marketplace/search": { label: "Search", section: "Marketplace" },
  "/connect": { label: "Connect", section: "Marketplace" },
  "/agent/plug-in": { label: "Plug In Your Agent", section: "Agent" },
  "/agent/build": { label: "Build Your Agent", section: "Agent" },
  "/buyer/keys": { label: "API Keys", section: "Agent" },
  "/buyer/subscriptions": { label: "Usage", section: "Agent" },
  "/buyer/wallet": { label: "Wallet", section: "Agent" },
  "/provider/listings": { label: "My Listings", section: "Provider" },
  "/provider/listings/new": { label: "Deploy Your API", section: "Provider" },
  "/provider/analytics": { label: "Analytics", section: "Provider" },
  "/provider/payouts": { label: "Payouts", section: "Provider" },
};

const QUICK_ACTIONS = [
  { label: "Deploy API", href: "/provider/listings/new", icon: "+" },
  { label: "Search", href: "/marketplace/search", icon: "⌕" },
  { label: "Market", href: "/marketplace", icon: "◈" },
];

function buildCrumbs(pathname: string): Crumb[] {
  // Exact match first
  const exact = ROUTE_MAP[pathname];
  if (exact) {
    return [
      { label: exact.section, href: sectionHref(exact.section) },
      { label: exact.label },
    ];
  }

  // Dynamic: /provider/listings/[id]
  if (pathname.startsWith("/provider/listings/") && pathname.split("/").length === 4) {
    return [
      { label: "Provider", href: "/provider/listings" },
      { label: "My Listings", href: "/provider/listings" },
      { label: "Listing Detail" },
    ];
  }

  // Dynamic: /marketplace/[slug]
  if (pathname.startsWith("/marketplace/") && pathname.split("/").length === 3) {
    return [
      { label: "Marketplace", href: "/marketplace" },
      { label: "Listing Detail" },
    ];
  }

  // Fallback
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((seg, i) => ({
    label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "),
    href: i < segments.length - 1 ? "/" + segments.slice(0, i + 1).join("/") : undefined,
  }));
}

function sectionHref(section: string): string {
  if (section === "Marketplace") return "/marketplace";
  if (section === "Agent") return "/agent/plug-in";
  if (section === "Provider") return "/provider/listings";
  return "/";
}

export function TopBar() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname || "/"), [pathname]);

  return (
    <header className="flex items-center justify-between h-12 px-6 border-b border-surface-4 bg-surface-1/60 backdrop-blur-sm shrink-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs min-w-0">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-zinc-600">/</span>}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="text-zinc-500 hover:text-zinc-300 transition-colors truncate"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-zinc-200 font-medium truncate">
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      {/* Quick actions */}
      <div className="flex items-center gap-1">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all duration-150",
              pathname === action.href
                ? "bg-brand-600/15 text-brand-300"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-surface-3"
            )}
          >
            <span className="text-sm">{action.icon}</span>
            <span className="hidden md:inline">{action.label}</span>
          </Link>
        ))}
      </div>
    </header>
  );
}
