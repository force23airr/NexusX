// ═══════════════════════════════════════════════════════════════
// NexusX — usePriceTicker Hook
// apps/web/src/hooks/usePriceTicker.ts
//
// Custom React hook for real-time price ticker data via WebSocket.
//
// - Connects to ws://<host>/ws/prices on mount
// - On first message (snapshot): replaces entire state
// - On tick messages: merges into state
// - Auto-reconnect with exponential backoff (1s → 30s cap)
// - Falls back to HTTP polling after 5 consecutive WS failures
// - Cleans up on unmount
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { marketplace } from "@/lib/api";
import type { PriceTick } from "@/types";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_WS_FAILURES_BEFORE_FALLBACK = 5;
const POLLING_INTERVAL_MS = 15_000;

export function usePriceTicker(): PriceTick[] {
  const [ticks, setTicks] = useState<PriceTick[]>([]);
  const tickMapRef = useRef<Map<string, PriceTick>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionModeRef = useRef<"websocket" | "polling">("websocket");
  const mountedRef = useRef(true);

  const updateTicks = useCallback(() => {
    setTicks(Array.from(tickMapRef.current.values()));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return; // already polling
    connectionModeRef.current = "polling";

    const poll = async () => {
      try {
        const data = await marketplace.getPriceTicker();
        if (!mountedRef.current) return;
        tickMapRef.current.clear();
        for (const tick of data) {
          tickMapRef.current.set(tick.listingId, tick);
        }
        updateTicks();
      } catch {
        // Silently continue polling
      }
    };

    poll(); // immediate first poll
    pollingIntervalRef.current = setInterval(poll, POLLING_INTERVAL_MS);
  }, [updateTicks]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/prices`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        connectionModeRef.current = "websocket";
        stopPolling();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "snapshot" && Array.isArray(data.ticks)) {
            tickMapRef.current.clear();
            for (const tick of data.ticks) {
              tickMapRef.current.set(tick.listingId, tick);
            }
            updateTicks();
          } else if (data.type === "tick" && data.tick) {
            tickMapRef.current.set(data.tick.listingId, data.tick);
            updateTicks();
          }
        } catch {
          // Malformed message — ignore
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mountedRef.current) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // The close event will fire after this — reconnect handled there
        ws.close();
      };
    } catch {
      scheduleReconnect();
    }
  }, [updateTicks, stopPolling]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;

    reconnectAttemptsRef.current++;

    if (reconnectAttemptsRef.current >= MAX_WS_FAILURES_BEFORE_FALLBACK) {
      // Fall back to polling
      startPolling();
      // But keep trying WebSocket in the background at max interval
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, MAX_RECONNECT_DELAY_MS);
      return;
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, delay);
  }, [connect, startPolling]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      stopPolling();
    };
  }, [connect, stopPolling]);

  return ticks;
}
