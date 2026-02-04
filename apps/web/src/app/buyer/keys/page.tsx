// ═══════════════════════════════════════════════════════════════
// NexusX — Buyer API Keys Page
// apps/web/src/app/buyer/keys/page.tsx
//
// Manage API keys for gateway authentication:
//   - Create / revoke keys
//   - View key stats and usage
//   - Copy raw key on creation
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { buyer } from "@/lib/api";
import { cn, formatNumber, relativeTime } from "@/lib/utils";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  rateLimitRpm: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt?: string | null;
};

export default function BuyerKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRateLimit, setNewKeyRateLimit] = useState(60);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await buyer.getApiKeys();
      setKeys(data);
    } catch (err) {
      console.error("Failed to load API keys:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setIsCreating(true);
    try {
      const result = await buyer.createApiKey(newKeyName.trim(), newKeyRateLimit);
      setCreatedRawKey(result.rawKey);
      setNewKeyName("");
      setNewKeyRateLimit(60);
      await load();
    } catch (err) {
      console.error("Failed to create API key:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    try {
      await fetch(`/api/buyer/keys?id=${keyId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      console.error("Failed to revoke key:", err);
    }
  };

  const handleCopy = () => {
    if (createdRawKey) {
      navigator.clipboard.writeText(createdRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const activeKeys = keys.filter((k) => k.status === "ACTIVE");
  const revokedKeys = keys.filter((k) => k.status === "REVOKED");

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="mt-1 text-zinc-400">Manage your gateway authentication keys.</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => {
            setShowCreateModal(true);
            setCreatedRawKey(null);
          }}
        >
          <span>+</span> Create Key
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Keys" value={String(keys.length)} accent="cyan" />
        <StatCard label="Active Keys" value={String(activeKeys.length)} accent="green" />
        <StatCard label="Revoked Keys" value={String(revokedKeys.length)} accent="amber" />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : keys.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-4 text-left">
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Key</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Rate Limit</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Last Used</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Created</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-zinc-100">{key.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-zinc-400">
                      {key.keyPrefix}••••••••
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", apiKeyStatusColor(key.status))}>
                      {key.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-zinc-300">
                      {formatNumber(key.rateLimitRpm)}/min
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">
                      {key.lastUsedAt ? relativeTime(key.lastUsedAt) : "Never"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">
                      {relativeTime(key.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {key.status === "ACTIVE" && (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">No API keys yet.</p>
          <p className="text-zinc-500 text-sm mt-2">Create your first API key to start making API calls.</p>
        </div>
      )}

      {/* Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !createdRawKey && setShowCreateModal(false)} />
          <div className="relative bg-surface-2 border border-surface-4 rounded-xl p-6 w-full max-w-md shadow-2xl">
            {createdRawKey ? (
              <>
                <h3 className="text-lg font-semibold text-zinc-100 mb-4">Key Created</h3>
                <div className="bg-surface-3 border border-amber-500/30 rounded-lg p-4 mb-4">
                  <p className="text-2xs text-amber-400 uppercase font-semibold mb-2">
                    Copy your key now — it won&apos;t be shown again
                  </p>
                  <code className="text-sm text-zinc-200 break-all block">{createdRawKey}</code>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleCopy} className="btn-primary flex-1">
                    {copied ? "Copied!" : "Copy to Clipboard"}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreatedRawKey(null);
                    }}
                    className="btn-secondary flex-1"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-zinc-100 mb-4">Create API Key</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold block mb-1.5">
                      Key Name
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Production, Staging"
                      className="w-full bg-surface-3 border border-surface-4 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand-400"
                    />
                  </div>
                  <div>
                    <label className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold block mb-1.5">
                      Rate Limit (requests/min)
                    </label>
                    <input
                      type="number"
                      value={newKeyRateLimit}
                      onChange={(e) => setNewKeyRateLimit(Number(e.target.value))}
                      min={1}
                      max={10000}
                      className="w-full bg-surface-3 border border-surface-4 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-400"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleCreate}
                    disabled={isCreating || !newKeyName.trim()}
                    className="btn-primary flex-1 disabled:opacity-50"
                  >
                    {isCreating ? "Creating..." : "Create Key"}
                  </button>
                  <button onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function apiKeyStatusColor(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-400",
    REVOKED: "bg-red-500/15 text-red-400",
    EXPIRED: "bg-zinc-500/15 text-zinc-400",
  };
  return map[status] || "bg-zinc-500/15 text-zinc-400";
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "green" | "amber" | "blue" | "cyan";
}) {
  const accentColor = {
    green: "from-emerald-500/10",
    amber: "from-amber-500/10",
    blue: "from-blue-500/10",
    cyan: "from-brand-500/10",
  }[accent];

  return (
    <div className="stat-card">
      <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none", accentColor)} />
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">{label}</p>
      <p className="text-xl font-bold font-mono text-zinc-100 mt-1 relative">{value}</p>
    </div>
  );
}
