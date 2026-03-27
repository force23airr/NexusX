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
import type {
  ListingDetail,
  OperationVerificationResponse,
  ProviderAnalytics,
  ListingStatus,
} from "@/types";
import { ActivationWizard } from "@/components/provider/ActivationWizard";
import { IntegrationPanel } from "@/components/provider/IntegrationPanel";
import DiscoveryMetadataFields, {
  buildDiscoveryDomainMetadata,
  extractRoutingMetadata,
  stringifyDomainMetadata,
} from "@/components/provider/DiscoveryMetadataFields";
import ListingContractFields from "@/components/provider/ListingContractFields";
import ListingOperationContractsFields from "@/components/provider/ListingOperationContractsFields";
import {
  createEmptyOperationContract,
  mergeOperationContractsIntoSchemaSpec,
  summarizeOperationTarget,
} from "@/lib/listingOperationContracts";

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
  const routingMetadata = extractRoutingMetadata(listing.domainMetadata);
  const genericDomainMetadata = stringifyDomainMetadata(listing.domainMetadata);
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

      {(listing.intents?.length ||
        listing.capabilityTags?.length ||
        listing.complianceTags?.length ||
        listing.availabilityRegions?.length ||
        listing.restrictedRegions?.length ||
        routingMetadata.latencyRegions.length ||
        routingMetadata.routingRegions.length ||
        routingMetadata.edgeRegions.length ||
        listing.inputModalities?.length ||
        listing.outputModalities?.length ||
        listing.domainMetadata) && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-300">Discovery Metadata</h3>
          <MetadataGroup label="Intents" values={listing.intents ?? []} />
          <MetadataGroup label="Capability Tags" values={listing.capabilityTags ?? []} />
          <MetadataGroup label="Compliance Tags" values={listing.complianceTags ?? []} />
          <MetadataGroup label="Availability Regions" values={listing.availabilityRegions ?? []} emptyLabel="Global" />
          <MetadataGroup label="Restricted Regions" values={listing.restrictedRegions ?? []} />
          <MetadataGroup label="Latency Regions" values={routingMetadata.latencyRegions} />
          <MetadataGroup label="Routing Regions" values={routingMetadata.routingRegions} />
          <MetadataGroup label="Edge Regions" values={routingMetadata.edgeRegions} />
          <MetadataGroup label="Input Modalities" values={listing.inputModalities ?? []} />
          <MetadataGroup label="Output Modalities" values={listing.outputModalities ?? []} />
          {genericDomainMetadata && (
            <div>
              <p className="text-xs text-zinc-500 mb-1 font-semibold uppercase tracking-wider">
                Domain Metadata
              </p>
              <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 overflow-x-auto">
                <code className="text-xs font-mono text-zinc-300">
                  {genericDomainMetadata}
                </code>
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-300">Agent Contract</h3>
          {listing.readiness && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                listing.readiness.issues.length === 0
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
              )}
            >
              Readiness {listing.readiness.score}%
            </span>
          )}
        </div>

        <MetadataGroup label="Auth Schemes" values={listing.authSchemes ?? []} />
        <MetadataGroup label="Interaction Modes" values={listing.interactionModes ?? []} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <ContractSummaryRow label="Risk Level" value={listing.riskLevel ?? "LOW"} />
          <ContractSummaryRow
            label="Side-Effect Level"
            value={listing.sideEffectLevel ?? "READ_ONLY"}
          />
          <ContractSummaryRow
            label="Human Approval"
            value={listing.humanApprovalRequired ? "Required" : "Not required"}
          />
          <ContractSummaryRow
            label="Health Strategy"
            value={listing.noHealthProbe ? "No probe" : "Health probe expected"}
          />
        </div>

        {listing.readiness?.issues.length ? (
          <div>
            <p className="text-xs text-amber-400 mb-2 font-semibold uppercase tracking-wider">
              Blocking Issues
            </p>
            <ul className="space-y-1 text-sm text-amber-300">
              {listing.readiness.issues.map((issue) => (
                <li key={issue}>• {issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {listing.readiness?.warnings.length ? (
          <div>
            <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">
              Warnings
            </p>
            <ul className="space-y-1 text-sm text-zinc-400">
              {listing.readiness.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {listing.operationContracts?.length ? (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-300">Operation Contracts</h3>
          <div className="space-y-3">
            {listing.operationContracts.map((operation) => (
              <div
                key={operation.operationId}
                className="rounded-lg border border-surface-4 bg-surface-2 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{operation.name}</span>
                  <span className="rounded-md border border-surface-4 bg-surface-1 px-2 py-0.5 text-2xs text-zinc-400 font-mono">
                    {summarizeOperationTarget(operation)}
                  </span>
                  <span className="rounded-md border border-surface-4 bg-surface-1 px-2 py-0.5 text-2xs text-zinc-500">
                    {operation.mode}
                  </span>
                  {operation.authScheme && (
                    <span className="rounded-md border border-surface-4 bg-surface-1 px-2 py-0.5 text-2xs text-zinc-500">
                      {operation.authScheme}
                    </span>
                  )}
                </div>
                {operation.description && (
                  <p className="mt-2 text-sm text-zinc-400">{operation.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
  onSaved: () => void | Promise<void>;
}) {
  const isEditable = listing.status === "DRAFT" || listing.status === "PAUSED";
  const routingMetadata = extractRoutingMetadata(listing.domainMetadata);
  const [form, setForm] = useState({
    name: listing.name,
    description: listing.description,
    baseUrl: listing.baseUrl,
    healthCheckUrl: listing.healthCheckUrl || "",
    docsUrl: listing.docsUrl || "",
    sandboxUrl: listing.sandboxUrl || "",
    tags: listing.tags ?? [],
    intents: listing.intents ?? [],
    availabilityRegions: listing.availabilityRegions ?? [],
    restrictedRegions: listing.restrictedRegions ?? [],
    complianceTags: listing.complianceTags ?? [],
    capabilityTags: listing.capabilityTags ?? [],
    inputModalities: listing.inputModalities ?? [],
    outputModalities: listing.outputModalities ?? [],
    latencyRegions: routingMetadata.latencyRegions,
    routingRegions: routingMetadata.routingRegions,
    edgeRegions: routingMetadata.edgeRegions,
    domainMetadataText: stringifyDomainMetadata(listing.domainMetadata),
    schemaSpecBase: listing.schemaSpec ?? null,
    operationContracts: listing.operationContracts ?? [],
    authSchemes: listing.authSchemes ?? (listing.authType ? [listing.authType] : []),
    interactionModes: listing.interactionModes ?? [],
    humanApprovalRequired: listing.humanApprovalRequired ?? false,
    noHealthProbe: listing.noHealthProbe ?? false,
    riskLevel: listing.riskLevel ?? "LOW",
    sideEffectLevel: listing.sideEffectLevel ?? "READ_ONLY",
    floorPriceUsdc: listing.floorPriceUsdc.toString(),
    ceilingPriceUsdc: listing.ceilingPriceUsdc?.toString() || "",
    capacityPerMinute: listing.capacityPerMinute.toString(),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [verification, setVerification] = useState<OperationVerificationResponse | null>(null);
  const verificationSummary = verification?.summary ?? listing.operationVerification;

  const updateField = (
    key: string,
    value: string | string[] | boolean | Record<string, unknown> | null | ListingDetail["operationContracts"],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveMsg(null);
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMsg(null);
    setFieldErrors({});
    try {
      const domainMetadata = buildDiscoveryDomainMetadata({
        domainMetadataText: form.domainMetadataText,
        latencyRegions: form.latencyRegions,
        routingRegions: form.routingRegions,
        edgeRegions: form.edgeRegions,
      });
      const schemaSpec = mergeOperationContractsIntoSchemaSpec(
        form.schemaSpecBase,
        form.operationContracts ?? [],
      );
      await provider.updateListing(listing.id, {
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl,
        healthCheckUrl: form.healthCheckUrl || null,
        docsUrl: form.docsUrl || null,
        sandboxUrl: form.sandboxUrl || null,
        authSchemes: form.authSchemes,
        interactionModes: form.interactionModes,
        humanApprovalRequired: form.humanApprovalRequired,
        noHealthProbe: form.noHealthProbe,
        riskLevel: form.riskLevel,
        sideEffectLevel: form.sideEffectLevel,
        schemaSpec,
        operationContracts: form.operationContracts,
        tags: form.tags,
        intents: form.intents,
        availabilityRegions: form.availabilityRegions,
        restrictedRegions: form.restrictedRegions,
        complianceTags: form.complianceTags,
        capabilityTags: form.capabilityTags,
        inputModalities: form.inputModalities,
        outputModalities: form.outputModalities,
        domainMetadata: domainMetadata ?? null,
        floorPriceUsdc: parseFloat(form.floorPriceUsdc),
        ceilingPriceUsdc: form.ceilingPriceUsdc
          ? parseFloat(form.ceilingPriceUsdc)
          : null,
        capacityPerMinute: parseInt(form.capacityPerMinute, 10),
      });
      setSaveMsg("Saved successfully");
      await onSaved();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("Domain metadata")) {
        setFieldErrors({ domainMetadataText: err.message });
      }
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyOperations = async () => {
    setIsVerifying(true);
    setSaveMsg(null);
    try {
      const result = await provider.verifyOperations(listing.id);
      setVerification(result);
      await onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Operation verification failed";
      setSaveMsg(msg);
    } finally {
      setIsVerifying(false);
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
          Discovery Metadata
        </h3>
        <DiscoveryMetadataFields
          value={{
            tags: form.tags,
            intents: form.intents,
            availabilityRegions: form.availabilityRegions,
            restrictedRegions: form.restrictedRegions,
            complianceTags: form.complianceTags,
            capabilityTags: form.capabilityTags,
            inputModalities: form.inputModalities,
            outputModalities: form.outputModalities,
            latencyRegions: form.latencyRegions,
            routingRegions: form.routingRegions,
            edgeRegions: form.edgeRegions,
            domainMetadataText: form.domainMetadataText,
          }}
          errors={fieldErrors}
          onChange={(field, value) => updateField(field, value)}
        />
      </div>

      <div className="card p-6 space-y-5">
        <h3 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
          Agent Contract
        </h3>
        <ListingContractFields
          value={{
            authSchemes: form.authSchemes,
            interactionModes: form.interactionModes,
            humanApprovalRequired: form.humanApprovalRequired,
            noHealthProbe: form.noHealthProbe,
            riskLevel: form.riskLevel,
            sideEffectLevel: form.sideEffectLevel,
          }}
          onChange={(field, value) => updateField(field, value)}
        />
      </div>

      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-surface-4 pb-3">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Operation Contracts</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Verify actions through the real gateway path before activation.
            </p>
          </div>
          <button
            type="button"
            onClick={handleVerifyOperations}
            disabled={isVerifying || (form.operationContracts ?? []).length === 0}
            className={cn(
              "rounded-lg border border-brand-500/20 bg-brand-500/5 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/10",
              (isVerifying || (form.operationContracts ?? []).length === 0) &&
                "opacity-60 cursor-not-allowed",
            )}
          >
            {isVerifying ? "Verifying..." : "Verify Operations"}
          </button>
        </div>
        <ListingOperationContractsFields
          value={form.operationContracts ?? []}
          onChange={(next) => updateField("operationContracts", next)}
          onAdd={() =>
            updateField("operationContracts", [
              ...(form.operationContracts ?? []),
              createEmptyOperationContract((form.operationContracts ?? []).length),
            ])
          }
        />

        {verificationSummary ? (
          <div className="rounded-xl border border-surface-4 bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <VerificationBadge
                label={`status: ${verificationSummary.status.toLowerCase()}`}
                tone={
                  verificationSummary.status === "VERIFIED"
                    ? "good"
                    : verificationSummary.status === "FAILED"
                      ? "bad"
                      : verificationSummary.status === "WARNING" ||
                          verificationSummary.status === "STALE"
                        ? "warn"
                        : "neutral"
                }
              />
              <VerificationBadge
                label={`${verificationSummary.verifiedCount} verified`}
                tone="good"
              />
              <VerificationBadge
                label={`${verificationSummary.warningCount} warnings`}
                tone="warn"
              />
              <VerificationBadge
                label={`${verificationSummary.failedCount} failed`}
                tone="bad"
              />
              <VerificationBadge
                label={`${verificationSummary.skippedCount} skipped`}
                tone="neutral"
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Last verified: {verificationSummary.lastVerifiedAt ?? "never"}
            </p>
          </div>
        ) : null}

        {verification ? (
          <div className="space-y-3 rounded-xl border border-surface-4 bg-surface-2 p-4">
            <div className="flex flex-wrap gap-2">
              <VerificationBadge label={`${verification.verifiedCount} verified`} tone="good" />
              <VerificationBadge label={`${verification.warningCount} warnings`} tone="warn" />
              <VerificationBadge label={`${verification.failedCount} failed`} tone="bad" />
              <VerificationBadge label={`${verification.skippedCount} skipped`} tone="neutral" />
            </div>
            <div className="space-y-2">
              {verification.results.map((result) => (
                <div
                  key={result.operationId}
                  className="rounded-lg border border-surface-4 bg-surface-1 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{result.name}</span>
                    <span className="font-mono text-2xs text-zinc-500">
                      {result.method} {result.path}
                    </span>
                    <VerificationBadge label={result.outcome} tone={verificationTone(result.outcome)} />
                    {result.statusCode > 0 && (
                      <span className="text-2xs text-zinc-500">
                        HTTP {result.statusCode} · {result.latencyMs}ms
                      </span>
                    )}
                    {result.sandboxUsed && (
                      <span className="text-2xs text-emerald-300">sandbox</span>
                    )}
                  </div>
                  {result.reason && (
                    <p className="mt-2 text-sm text-zinc-400">{result.reason}</p>
                  )}
                  {result.responsePreview && (
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-surface-4 bg-surface-2 p-3 text-xs text-zinc-300">
                      {result.responsePreview}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
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

function ContractSummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-2 px-3 py-2">
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">{label}</p>
      <p className="mt-1 text-sm text-zinc-300">{value}</p>
    </div>
  );
}

function verificationTone(outcome: OperationVerificationResponse["results"][number]["outcome"]): "good" | "warn" | "bad" | "neutral" {
  switch (outcome) {
    case "verified":
      return "good";
    case "warning":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

function VerificationBadge({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    bad: "border-red-500/20 bg-red-500/10 text-red-300",
    neutral: "border-surface-4 bg-surface-2 text-zinc-400",
  }[tone];

  return (
    <span className={cn("rounded-md border px-2 py-0.5 text-2xs font-medium", toneClass)}>
      {label}
    </span>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
      {label}
    </label>
  );
}

function MetadataGroup({
  label,
  values,
  emptyLabel,
}: {
  label: string;
  values: string[];
  emptyLabel?: string;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">{label}</p>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="px-2.5 py-1 bg-surface-3 text-zinc-400 text-xs rounded-md"
            >
              {value}
            </span>
          ))}
        </div>
      ) : emptyLabel ? (
        <p className="text-sm text-zinc-400">{emptyLabel}</p>
      ) : null}
    </div>
  );
}
