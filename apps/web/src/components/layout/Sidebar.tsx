// ═══════════════════════════════════════════════════════════════
// NexusX — Sidebar Navigation
// apps/web/src/components/layout/Sidebar.tsx
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
                    "flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                    "bg-brand-600/20 text-brand-300 border border-brand-600/30 hover:bg-brand-600/30 hover:border-brand-500/40",
                    collapsed && "px-0"
                  )}
                  title={collapsed ? section.cta.label : undefined}
                >
                  <span className="text-base shrink-0">&#x25B3;</span>
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
