// ═══════════════════════════════════════════════════════════════
// NexusX — Sidebar Navigation
// apps/web/src/components/layout/Sidebar.tsx
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
  cta?: { label: string; href: string };
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Marketplace",
    items: [
      { label: "Market", href: "/marketplace", icon: "◈" },
      { label: "Search", href: "/marketplace/search", icon: "⌕" },
      { label: "Connect", href: "/connect", icon: "⬡" },
    ],
  },
  {
    title: "Agent",
    items: [
      { label: "Plug In Your Agent", href: "/agent/plug-in", icon: "⏚" },
      { label: "Build Your Agent", href: "/agent/build", icon: "⚙" },
      { label: "API Keys", href: "/buyer/keys", icon: "⚿" },
      { label: "Usage", href: "/buyer/subscriptions", icon: "↻" },
      { label: "Wallet", href: "/buyer/wallet", icon: "◆" },
    ],
  },
  {
    title: "Provider",
    cta: { label: "Deploy Your API", href: "/provider/listings/new" },
    items: [
      { label: "My Listings", href: "/provider/listings", icon: "▤" },
      { label: "Analytics", href: "/provider/analytics", icon: "◰" },
      { label: "Payouts", href: "/provider/payouts", icon: "⇥" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { isSignedIn, user } = useUser();

  return (
    <aside
      className={cn(
        "flex flex-col bg-surface-1 border-r border-surface-4 transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-surface-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
          N
        </div>
        {!collapsed && (
          <span className="text-lg font-bold tracking-tight">
            Nexus<span className="text-brand-400">X</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <h3 className="px-4 mb-2 text-2xs font-semibold uppercase tracking-widest text-zinc-500">
                {section.title}
              </h3>
            )}
            {section.cta && (
              <div className="px-2 mb-2">
                <Link
                  href={section.cta.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                    "bg-brand-600/20 text-brand-300 border border-brand-600/30 hover:bg-brand-600/30 hover:border-brand-500/40",
                    collapsed && "justify-center px-0"
                  )}
                  title={collapsed ? section.cta.label : undefined}
                >
                  <span className="shrink-0 w-5 text-center flex items-center justify-center">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                  </span>
                  {!collapsed && <span>{section.cta.label}</span>}
                </Link>
              </div>
            )}
            <ul className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                        isActive
                          ? "bg-brand-600/15 text-brand-300 font-medium"
                          : "text-zinc-400 hover:bg-surface-3 hover:text-zinc-200"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="text-base shrink-0 w-5 text-center">{item.icon}</span>
                      {!collapsed && <span>{item.label}</span>}
                      {isActive && !collapsed && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-400" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-surface-4">
        {isSignedIn ? (
          <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8",
                },
              }}
            />
            {!collapsed && (
              <span className="text-sm text-zinc-300 truncate">
                {user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Account"}
              </span>
            )}
          </div>
        ) : (
          <SignInButton mode="modal">
            <button
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 w-full",
                "text-zinc-400 hover:bg-surface-3 hover:text-zinc-200",
                collapsed && "justify-center px-0"
              )}
            >
              <span className="text-base shrink-0 w-5 text-center">⊕</span>
              {!collapsed && <span>Sign In</span>}
            </button>
          </SignInButton>
        )}
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mx-2 mb-4 btn-ghost flex items-center justify-center gap-2"
      >
        <span className="text-base">{collapsed ? "→" : "←"}</span>
        {!collapsed && <span className="text-xs text-zinc-500">Collapse</span>}
      </button>
    </aside>
  );
}
