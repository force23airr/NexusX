"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { marketplace, buyer } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatPricePerCall,
  formatNumber,
  formatLatency,
  formatPercent,
  listingTypeIcon,
  listingTypeLabel,
  listingStatusColor,
} from "@/lib/utils";
import type {
  ListingDetail,
  PriceHistoryResponse,
  PlaygroundResponse,
} from "@/types";

const PERIODS = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

export default function ListingDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Price history state
  const [pricePeriod, setPricePeriod] = useState("7d");
  const [priceData, setPriceData] = useState<PriceHistoryResponse | null>(null);

  // Playground state
  const [pgMethod, setPgMethod] = useState("GET");
  const [pgUrl, setPgUrl] = useState("");
  const [pgHeaders, setPgHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [pgBody, setPgBody] = useState("");
  const [pgResponse, setPgResponse] = useState<PlaygroundResponse | null>(null);
  const [pgLoading, setPgLoading] = useState(false);

  // Watchlist state
  const [isWatching, setIsWatching] = useState(false);
  const [showAlertPopover, setShowAlertPopover] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("");
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  // Fetch listing detail
  useEffect(() => {
    if (!slug) return;
    setIsLoading(true);
    marketplace
      .getListingDetail(slug)
      .then((data) => {
        setListing(data);
        setPgUrl(data.sandboxUrl || data.baseUrl);
        if (data.sampleRequest) {
          setPgBody(JSON.stringify(data.sampleRequest, null, 2));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [slug]);

  // Fetch price history
  useEffect(() => {
    if (!slug) return;
    marketplace
      .getPriceHistory(slug, pricePeriod)
      .then(setPriceData)
      .catch(console.error);
  }, [slug, pricePeriod]);

  // Check if already watching
  useEffect(() => {
    if (!listing) return;
    buyer
      .getWatchlist()
      .then((items) => {
        const match = items.find((w) => w.listingId === listing.id);
        if (match) {
          setIsWatching(true);
          if (match.alertThreshold) {
            setAlertThreshold(String(match.alertThreshold));
          }
        }
      })
      .catch(() => {});
  }, [listing]);

  // Playground send
  async function handleSendRequest() {
    setPgLoading(true);
    try {
      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = JSON.parse(pgHeaders);
      } catch {}
      const res = await marketplace.sendPlaygroundRequest({
        url: pgUrl,
        method: pgMethod as "GET" | "POST" | "PUT" | "DELETE",
        headers: parsedHeaders,
        body: pgBody || undefined,
      });
      setPgResponse(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed";
      setPgResponse({ status: 0, headers: {}, body: message, responseTimeMs: 0 });
    } finally {
      setPgLoading(false);
    }
  }

  // Watchlist toggle
  async function handleWatchlistToggle() {
    if (!listing) return;
    setWatchlistLoading(true);
    try {
      if (isWatching) {
        await buyer.removeFromWatchlist(listing.id);
        setIsWatching(false);
        setShowAlertPopover(false);
      } else {
        setShowAlertPopover(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setWatchlistLoading(false);
    }
  }

  async function handleAddToWatchlist() {
    if (!listing) return;
    setWatchlistLoading(true);
    try {
      const threshold = alertThreshold ? parseFloat(alertThreshold) : undefined;
      await buyer.addToWatchlist({
        listingId: listing.id,
        alertOnPriceDrop: !!threshold,
        alertThreshold: threshold,
      });
      setIsWatching(true);
      setShowAlertPopover(false);
    } catch (err) {
      console.error(err);
    } finally {
      setWatchlistLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-10 w-64 bg-surface-3/50 rounded animate-pulse" />
        <div className="h-6 w-96 bg-surface-3/50 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="stat-card h-24 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="card py-16 text-center">
        <p className="text-zinc-400">{error || "Listing not found."}</p>
        <Link href="/marketplace" className="btn-primary mt-4 inline-block">
          Back to Marketplace
        </Link>
      </div>
    );
  }

  const priceChange =
    listing.priceHistory.length >= 2
      ? listing.priceHistory[listing.priceHistory.length - 1].changePercent
      : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/marketplace" className="hover:text-zinc-300 transition-colors">
          Marketplace
        </Link>
        <span>/</span>
        <span className="text-zinc-300">{listing.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{listingTypeIcon(listing.listingType)}</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{listing.name}</h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              by {listing.providerName} · {listingTypeLabel(listing.listingType)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("badge", listingStatusColor(listing.status))}>
            {listing.status}
          </span>
          {/* Watchlist Button */}
          <div className="relative">
            <button
              onClick={handleWatchlistToggle}
              disabled={watchlistLoading}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                isWatching
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
                  : "btn-secondary"
              )}
            >
              {isWatching ? "★ Watching" : "☆ Add to Watchlist"}
            </button>
            {/* Alert Popover */}
            {showAlertPopover && (
              <div className="absolute right-0 top-12 w-72 card p-4 z-50 shadow-xl">
                <h4 className="text-sm font-semibold text-zinc-200 mb-2">
                  Set Price Alert (optional)
                </h4>
                <p className="text-2xs text-zinc-500 mb-3">
                  Get notified when the price drops to or below this threshold.
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-zinc-400">$</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    placeholder={formatPricePerCall(listing.currentPriceUsdc)}
                    className="input-base flex-1"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddToWatchlist}
                    disabled={watchlistLoading}
                    className="btn-primary flex-1 text-xs"
                  >
                    Add to Watchlist
                  </button>
                  <button
                    onClick={() => setShowAlertPopover(false)}
                    className="btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {listing.tags.map((tag) => (
          <span key={tag} className="badge bg-surface-4 text-zinc-400">
            {tag}
          </span>
        ))}
      </div>

      {/* Price Card + Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
            Current Price
          </p>
          <p className="text-lg font-bold font-mono text-brand-300 mt-1">
            {formatPricePerCall(listing.currentPriceUsdc)}
          </p>
          <p
            className={cn(
              "text-2xs font-mono mt-0.5",
              priceChange > 0 ? "text-accent-green" : priceChange < 0 ? "text-accent-red" : "text-zinc-500"
            )}
          >
            {priceChange > 0 ? "▲" : priceChange < 0 ? "▼" : "─"}
            {Math.abs(priceChange).toFixed(1)}% (24h)
          </p>
        </div>
        <div className="stat-card">
          <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
            Price Range
          </p>
          <p className="text-sm font-mono text-zinc-200 mt-1">
            {formatPricePerCall(listing.floorPriceUsdc)}
            {listing.ceilingPriceUsdc && (
              <span className="text-zinc-500"> – {formatPricePerCall(listing.ceilingPriceUsdc)}</span>
            )}
          </p>
          <p className="text-2xs text-zinc-500 mt-0.5">Floor – Ceiling</p>
        </div>
        <div className="stat-card">
          <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
            Total Calls
          </p>
          <p className="text-lg font-bold font-mono text-zinc-100 mt-1">
            {formatNumber(listing.totalCalls)}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
            Rating
          </p>
          <p className="text-lg font-bold font-mono text-zinc-100 mt-1">
            {listing.avgRating.toFixed(1)} ★
          </p>
          <p className="text-2xs text-zinc-500 mt-0.5">
            {listing.ratingCount} reviews
          </p>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-300">Price History</h3>
          <div className="flex items-center gap-1 bg-surface-2 border border-surface-4 rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPricePeriod(p.value)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  pricePeriod === p.value
                    ? "bg-brand-600/20 text-brand-300"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {priceData && priceData.points.length > 0 ? (
          <>
            <div className="flex items-center gap-6 mb-3 text-xs">
              <span className="text-zinc-400">
                High: <span className="font-mono text-zinc-200">{formatPricePerCall(priceData.high)}</span>
              </span>
              <span className="text-zinc-400">
                Low: <span className="font-mono text-zinc-200">{formatPricePerCall(priceData.low)}</span>
              </span>
              <span className="text-zinc-400">
                Current: <span className="font-mono text-brand-300">{formatPricePerCall(priceData.current)}</span>
              </span>
            </div>
            <div className="h-48 flex items-end gap-1">
              {priceData.points.slice(-30).map((point, i) => {
                const max = priceData.high;
                const height = max > 0 ? (point.price / max) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end">
                    <div
                      className="w-full bg-brand-500/30 rounded-t border-t border-brand-400/50 transition-all hover:bg-brand-500/50"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${formatUsdc(point.price)} — ${new Date(point.timestamp).toLocaleDateString()}`}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-2xs text-zinc-500 mt-2">
              {priceData.points.length} data points
            </p>
          </>
        ) : (
          <div className="h-48 flex items-center justify-center">
            <p className="text-sm text-zinc-500">No price history data for this period.</p>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Description</h3>
        <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
          {listing.description}
        </p>
      </div>

      {/* Video Embed */}
      {listing.videoUrl && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Demo Video</h3>
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-surface-1">
            <iframe
              src={listing.videoUrl}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Technical Details */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">Technical Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Base URL" value={listing.baseUrl} mono />
          {listing.docsUrl && <DetailRow label="Documentation" value={listing.docsUrl} mono link />}
          <DetailRow label="Auth Type" value={listing.authType} />
          <DetailRow label="Capacity" value={`${listing.capacityPerMinute} req/min`} />
          {listing.isUnique && <DetailRow label="Unique" value="Yes — exclusive data source" />}
        </div>
      </div>

      {/* Quality Metrics */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">Quality Metrics</h3>
        <div className="grid grid-cols-4 gap-6">
          <QualityMetric
            label="Uptime"
            value={formatPercent(listing.uptimePercent)}
            bar={listing.uptimePercent / 100}
            color="green"
          />
          <QualityMetric
            label="Latency"
            value={formatLatency(listing.avgLatencyMs)}
            bar={Math.min(listing.avgLatencyMs / 1000, 1)}
            color="brand"
          />
          <QualityMetric
            label="Error Rate"
            value={formatPercent(listing.errorRatePercent)}
            bar={listing.errorRatePercent / 5}
            color="red"
          />
          <QualityMetric
            label="Quality Score"
            value={formatPercent(listing.qualityScore * 100, 0)}
            bar={listing.qualityScore}
            color="brand"
          />
        </div>
      </div>

      {/* API Playground */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">API Playground</h3>
        <div className="grid grid-cols-2 gap-4">
          {/* Request Panel */}
          <div className="space-y-3">
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
              Request
            </p>
            <div className="flex items-center gap-2">
              <select
                value={pgMethod}
                onChange={(e) => setPgMethod(e.target.value)}
                className="input-base w-28"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
              <input
                type="text"
                value={pgUrl}
                onChange={(e) => setPgUrl(e.target.value)}
                className="input-base flex-1"
                placeholder="https://api.example.com/endpoint"
              />
            </div>
            <div>
              <label className="text-2xs text-zinc-500 mb-1 block">Headers (JSON)</label>
              <textarea
                value={pgHeaders}
                onChange={(e) => setPgHeaders(e.target.value)}
                className="input-base w-full h-20 font-mono text-xs resize-none"
              />
            </div>
            <div>
              <label className="text-2xs text-zinc-500 mb-1 block">Body</label>
              <textarea
                value={pgBody}
                onChange={(e) => setPgBody(e.target.value)}
                className="input-base w-full h-28 font-mono text-xs resize-none"
                placeholder="Request body..."
              />
            </div>
            <button
              onClick={handleSendRequest}
              disabled={pgLoading || !pgUrl}
              className="btn-primary w-full disabled:opacity-40"
            >
              {pgLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending…
                </span>
              ) : (
                "Send Request"
              )}
            </button>
          </div>

          {/* Response Panel */}
          <div className="space-y-3">
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
              Response
            </p>
            {pgResponse ? (
              <>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "badge",
                      pgResponse.status >= 200 && pgResponse.status < 300
                        ? "bg-emerald-500/15 text-emerald-400"
                        : pgResponse.status >= 400
                          ? "bg-red-500/15 text-red-400"
                          : "bg-amber-500/15 text-amber-400"
                    )}
                  >
                    {pgResponse.status || "Error"}
                  </span>
                  <span className="text-xs text-zinc-400 font-mono">
                    {pgResponse.responseTimeMs}ms
                  </span>
                </div>
                <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-auto max-h-64 whitespace-pre-wrap">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(pgResponse.body), null, 2);
                    } catch {
                      return pgResponse.body;
                    }
                  })()}
                </pre>
              </>
            ) : (
              <div className="bg-surface-1 border border-surface-4 rounded-lg p-8 flex items-center justify-center h-64">
                <p className="text-sm text-zinc-500">
                  Send a request to see the response.
                </p>
              </div>
            )}
          </div>
        </div>
        <p className="text-2xs text-zinc-600 mt-4">
          Requests are proxied through NexusX. Sandbox mode — no billing.
        </p>
      </div>

      {/* Sample Request / Response */}
      {(listing.sampleRequest || listing.sampleResponse) && (
        <div className="grid grid-cols-2 gap-4">
          {listing.sampleRequest && (
            <div className="card p-5">
              <h4 className="text-sm font-semibold text-zinc-300 mb-3">Sample Request</h4>
              <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-auto max-h-48">
                {JSON.stringify(listing.sampleRequest, null, 2)}
              </pre>
            </div>
          )}
          {listing.sampleResponse && (
            <div className="card p-5">
              <h4 className="text-sm font-semibold text-zinc-300 mb-3">Sample Response</h4>
              <pre className="bg-surface-1 border border-surface-4 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-auto max-h-48">
                {JSON.stringify(listing.sampleResponse, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ───

function DetailRow({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
}) {
  return (
    <div>
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">
        {label}
      </p>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "text-sm text-brand-400 hover:text-brand-300 transition-colors",
            mono && "font-mono"
          )}
        >
          {value}
        </a>
      ) : (
        <p className={cn("text-sm text-zinc-200", mono && "font-mono break-all")}>
          {value}
        </p>
      )}
    </div>
  );
}

function QualityMetric({
  label,
  value,
  bar,
  color,
}: {
  label: string;
  value: string;
  bar: number;
  color: "brand" | "green" | "red" | "amber";
}) {
  const barColor = {
    brand: "bg-brand-500",
    green: "bg-emerald-500",
    red: "bg-red-500",
    amber: "bg-amber-500",
  }[color];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-zinc-400">{label}</p>
        <p className="text-sm font-mono font-medium text-zinc-200">{value}</p>
      </div>
      <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.min(bar * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
