"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { provider } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatNumber,
  formatPricePerCall,
  formatPercent,
  formatLatency,
  listingStatusColor,
  listingTypeLabel,
} from "@/lib/utils";
import type { ListingDetail, ProviderAnalytics, ListingStatus } from "@/types";
import { ActivationWizard } from "@/components/provider/ActivationWizard";
import { IntegrationPanel } from "@/components/provider/IntegrationPanel";

type Tab = "overview" | "settings" | "integration";

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [analytics, setAnalytics] = useState<ProviderAnalytics | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [statusAction, setStatusAction] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [l, a] = await Promise.all([
        provider.getListing(id),
        provider.getListingAnalytics(id, "7d").catch(() => null),
      ]);
      setListing(l);
      setAnalytics(a);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load listing";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusChange = useCallback(
    async (action: "activate" | "pause" | "deprecate") => {
      if (!listing) return;
      setStatusAction(action);
      try {
        await provider.setStatus(listing.id, action);
        await loadData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Action failed";
        setError(message);
      } finally {
        setStatusAction(null);
      }
    },
    [listing, loadData]
  );

  // ─── Loading / Error States ───

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500 animate-pulse">Loading listing...</div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <button
          onClick={() => router.push("/provider/listings")}
          className="btn-ghost text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back to Listings
        </button>
        <div className="card p-6 border-red-600/30 bg-red-500/5">
          <p className="text-red-400">{error || "Listing not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-16">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/provider/listings")}
            className="btn-ghost text-zinc-400 hover:text-zinc-200"
          >
            &larr;
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
                {listing.name}
              </h1>
              <span
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-xs font-medium",
                  listingStatusColor(listing.status as ListingStatus)
                )}
              >
                {listing.status}
              </span>
              <span className="text-xs text-zinc-500">
                {listingTypeLabel(listing.listingType)}
              </span>
            </div>
            <p className="text-sm text-zinc-500 mt-1 font-mono">
              {listing.slug}
            </p>
          </div>
        </div>

        {/* Status actions */}
        <div className="flex items-center gap-2">
          {listing.status === "ACTIVE" && (
            <button
              onClick={() => handleStatusChange("pause")}
              disabled={!!statusAction}
              className="btn-ghost text-amber-400 border border-amber-600/30 hover:bg-amber-500/10 text-sm px-4 py-1.5"
            >
              {statusAction === "pause" ? "Pausing..." : "Pause"}
            </button>
          )}
          {(listing.status === "DRAFT" || listing.status === "PAUSED") && (
            <button
              onClick={() => setShowWizard(true)}
              className="btn-primary text-sm px-4 py-1.5"
            >
              Activate
            </button>
          )}
          {listing.status !== "DEPRECATED" && (
            <button
              onClick={() => handleStatusChange("deprecate")}
              disabled={!!statusAction}
              className="btn-ghost text-red-400 hover:bg-red-500/10 text-sm px-3 py-1.5"
            >
              {statusAction === "deprecate" ? "..." : "Deprecate"}
            </button>
          )}
        </div>
      </div>

      {/* ─── Activation Wizard ─── */}
      {showWizard && (
        <ActivationWizard
          listing={listing}
          onActivated={() => {
            setShowWizard(false);
            loadData();
          }}
          onClose={() => setShowWizard(false)}
        />
      )}

      {/* ─── Metrics Row ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Current Price"
          value={formatPricePerCall(listing.currentPriceUsdc)}
          sub={`Floor: ${formatPricePerCall(listing.floorPriceUsdc)}`}
        />
        <MetricCard
          label="Total Calls"
          value={formatNumber(listing.totalCalls)}
        />
        <MetricCard
          label="Revenue"
          value={formatUsdc(listing.totalRevenue)}
        />
        <MetricCard
          label="Quality"
          value={formatPercent(listing.qualityScore)}
          sub={`Uptime: ${formatPercent(listing.uptimePercent)}`}
        />
        <MetricCard
          label="Avg Latency"
          value={formatLatency(listing.avgLatencyMs)}
          sub={`Errors: ${formatPercent(listing.errorRatePercent)}`}
        />
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex gap-1 border-b border-surface-4">
        {(["overview", "settings", "integration"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium capitalize rounded-t-lg transition-colors",
              activeTab === tab
                ? "text-brand-300 border-b-2 border-brand-400 bg-surface-2"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ─── Tab Content ─── */}
      {activeTab === "overview" && (
        <OverviewTab listing={listing} analytics={analytics} />
      )}
      {activeTab === "settings" && (
        <SettingsTab listing={listing} onSaved={loadData} />
      )}
      {activeTab === "integration" && <IntegrationPanel listing={listing} />}
    </div>
  );
}

// ─── Metric Card ───

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className="text-xl font-bold text-zinc-100 mt-1">{value}</p>
      {sub && <p className="text-2xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Overview Tab ───

function OverviewTab({
  listing,
  analytics,
}: {
  listing: ListingDetail;
  analytics: ProviderAnalytics | null;
}) {
  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Description</h3>
        <p className="text-sm text-zinc-400 whitespace-pre-wrap">
          {listing.description}
        </p>
      </div>

      {/* Endpoints */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Endpoints</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Base URL</span>
            <span className="font-mono text-zinc-300">{listing.baseUrl}</span>
          </div>
          {listing.healthCheckUrl && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Health Check</span>
              <span className="font-mono text-zinc-300">{listing.healthCheckUrl}</span>
            </div>
          )}
          {listing.docsUrl && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Docs</span>
              <a
                href={listing.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-brand-400 hover:underline"
              >
                {listing.docsUrl}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Pricing */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Pricing</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 text-xs">Floor</p>
            <p className="text-lg font-bold text-zinc-200 font-mono">
              {formatPricePerCall(listing.floorPriceUsdc)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Current</p>
            <p className="text-lg font-bold text-brand-300 font-mono">
              {formatPricePerCall(listing.currentPriceUsdc)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Ceiling</p>
            <p className="text-lg font-bold text-zinc-200 font-mono">
              {listing.ceilingPriceUsdc
                ? formatPricePerCall(listing.ceilingPriceUsdc)
                : "No cap"}
            </p>
          </div>
        </div>
      </div>

      {/* Analytics summary */}
      {analytics && analytics.totalCalls > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">
            Last 7 Days
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-zinc-500 text-xs">Calls</p>
              <p className="text-lg font-bold text-zinc-200">
                {formatNumber(analytics.totalCalls)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Revenue</p>
              <p className="text-lg font-bold text-zinc-200">
                {formatUsdc(analytics.netRevenueUsdc)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Unique Buyers</p>
              <p className="text-lg font-bold text-zinc-200">
                {analytics.uniqueBuyers}
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Avg Rating</p>
              <p className="text-lg font-bold text-zinc-200">
                {analytics.avgRating > 0 ? analytics.avgRating.toFixed(1) : "N/A"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tags */}
      {listing.tags.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {listing.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 bg-surface-3 text-zinc-400 text-xs rounded-md"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sample Request/Response */}
      {(listing.sampleRequest || listing.sampleResponse) && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">
            Sample Request / Response
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {listing.sampleRequest && (
              <div>
                <p className="text-xs text-zinc-500 mb-1 font-semibold uppercase tracking-wider">
                  Request
                </p>
                <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 overflow-x-auto">
                  <code className="text-xs font-mono text-zinc-300">
                    {JSON.stringify(listing.sampleRequest, null, 2)}
                  </code>
                </pre>
              </div>
            )}
            {listing.sampleResponse && (
              <div>
                <p className="text-xs text-zinc-500 mb-1 font-semibold uppercase tracking-wider">
                  Response
                </p>
                <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 overflow-x-auto">
                  <code className="text-xs font-mono text-zinc-300">
                    {JSON.stringify(listing.sampleResponse, null, 2)}
                  </code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ───

function SettingsTab({
  listing,
  onSaved,
}: {
  listing: ListingDetail;
  onSaved: () => void;
}) {
  const isEditable = listing.status === "DRAFT" || listing.status === "PAUSED";
  const [form, setForm] = useState({
    name: listing.name,
    description: listing.description,
    baseUrl: listing.baseUrl,
    healthCheckUrl: listing.healthCheckUrl || "",
    docsUrl: listing.docsUrl || "",
    sandboxUrl: listing.sandboxUrl || "",
    floorPriceUsdc: listing.floorPriceUsdc.toString(),
    ceilingPriceUsdc: listing.ceilingPriceUsdc?.toString() || "",
    capacityPerMinute: listing.capacityPerMinute.toString(),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveMsg(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMsg(null);
    try {
      await provider.updateListing(listing.id, {
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl,
        healthCheckUrl: form.healthCheckUrl || null,
        docsUrl: form.docsUrl || null,
        sandboxUrl: form.sandboxUrl || null,
        floorPriceUsdc: parseFloat(form.floorPriceUsdc),
        ceilingPriceUsdc: form.ceilingPriceUsdc
          ? parseFloat(form.ceilingPriceUsdc)
          : null,
        capacityPerMinute: parseInt(form.capacityPerMinute, 10),
      });
      setSaveMsg("Saved successfully");
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditable) {
    return (
      <div className="card p-6 border-amber-600/20 bg-amber-500/5">
        <p className="text-sm text-amber-300">
          Settings can only be edited when the listing is in DRAFT or PAUSED status.
          {listing.status === "ACTIVE" && " Pause the listing first to make changes."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6 space-y-5">
        <h3 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
          General
        </h3>
        <div>
          <FieldLabel label="Name" />
          <input
            className="input-base w-full"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel label="Description" />
          <textarea
            className="input-base w-full min-h-[120px] resize-y"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <h3 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
          Endpoints
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel label="Base URL" />
            <input
              className="input-base w-full"
              value={form.baseUrl}
              onChange={(e) => updateField("baseUrl", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel label="Health Check URL" />
            <input
              className="input-base w-full"
              value={form.healthCheckUrl}
              onChange={(e) => updateField("healthCheckUrl", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel label="Docs URL" />
            <input
              className="input-base w-full"
              value={form.docsUrl}
              onChange={(e) => updateField("docsUrl", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel label="Sandbox URL" />
            <input
              className="input-base w-full"
              value={form.sandboxUrl}
              onChange={(e) => updateField("sandboxUrl", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <h3 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
          Pricing (USDC per call)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <FieldLabel label="Floor Price" />
            <input
              type="number"
              step="0.000001"
              min="0"
              className="input-base w-full font-mono"
              value={form.floorPriceUsdc}
              onChange={(e) => updateField("floorPriceUsdc", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel label="Ceiling Price" />
            <input
              type="number"
              step="0.000001"
              min="0"
              className="input-base w-full font-mono"
              value={form.ceilingPriceUsdc}
              onChange={(e) => updateField("ceilingPriceUsdc", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel label="Capacity / min" />
            <input
              type="number"
              min="1"
              className="input-base w-full font-mono"
              value={form.capacityPerMinute}
              onChange={(e) => updateField("capacityPerMinute", e.target.value)}
            />
          </div>
        </div>
      </div>

      {saveMsg && (
        <div
          className={cn(
            "text-sm p-3 rounded-lg",
            saveMsg === "Saved successfully"
              ? "text-emerald-400 bg-emerald-500/5 border border-emerald-600/30"
              : "text-red-400 bg-red-500/5 border border-red-600/30"
          )}
        >
          {saveMsg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={cn(
            "btn-primary min-w-[120px]",
            isSaving && "opacity-60 cursor-not-allowed"
          )}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Field Label (local) ───

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
      {label}
    </label>
  );
}
