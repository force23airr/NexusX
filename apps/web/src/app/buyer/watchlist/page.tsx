"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { buyer } from "@/lib/api";
import {
  cn,
  formatPricePerCall,
  relativeTime,
} from "@/lib/utils";
import type { WatchlistItem } from "@/types";

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    buyer
      .getWatchlist()
      .then(setItems)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  async function handleRemove(listingId: string) {
    try {
      await buyer.removeFromWatchlist(listingId);
      setItems((prev) => prev.filter((item) => item.listingId !== listingId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
        <p className="mt-1 text-zinc-400">
          Track listings and get alerted on price changes.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="card h-16 animate-pulse bg-surface-3/50"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-lg text-zinc-500 mb-2">☆</p>
          <p className="text-zinc-400 mb-4">
            Your watchlist is empty. Browse the marketplace to find APIs.
          </p>
          <Link href="/marketplace" className="btn-primary inline-block">
            Browse Marketplace
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-4">
                <th className="text-left px-5 py-3 text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Name
                </th>
                <th className="text-right px-5 py-3 text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Current Price
                </th>
                <th className="text-right px-5 py-3 text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Alert Price
                </th>
                <th className="text-center px-5 py-3 text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Status
                </th>
                <th className="text-right px-5 py-3 text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Added
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const alertActive =
                  item.alertOnPriceDrop &&
                  item.alertThreshold !== null &&
                  item.currentPriceUsdc <= item.alertThreshold;

                return (
                  <tr
                    key={item.id}
                    className="border-b border-surface-4 last:border-0 hover:bg-surface-3/30 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/marketplace/${item.listingSlug}`}
                        className="text-sm font-medium text-zinc-200 hover:text-brand-300 transition-colors"
                      >
                        {item.listingName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-mono text-zinc-200">
                        {formatPricePerCall(item.currentPriceUsdc)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {item.alertThreshold !== null ? (
                        <span className="text-sm font-mono text-zinc-400">
                          {formatPricePerCall(item.alertThreshold)}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {item.alertOnPriceDrop ? (
                        alertActive ? (
                          <span className="badge bg-emerald-500/15 text-emerald-400">
                            Alert Active
                          </span>
                        ) : (
                          <span className="badge bg-surface-4 text-zinc-400">
                            Watching
                          </span>
                        )
                      ) : (
                        <span className="badge bg-surface-4 text-zinc-500">
                          No Alert
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-xs text-zinc-500">
                        {relativeTime(item.createdAt)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRemove(item.listingId)}
                        className="btn-ghost text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
