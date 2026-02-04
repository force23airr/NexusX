// ═══════════════════════════════════════════════════════════════
// NexusX — WebSocket Price Stream Server
// apps/gateway/src/services/priceWebSocket.ts
//
// Subscribes to Redis pub/sub channel "nexusx:prices" and
// broadcasts price ticks to all connected WebSocket clients.
//
// On connect: sends the full snapshot (all latest prices) so
// new clients don't have to wait for the next change.
//
// Heartbeat: ping every 30s, terminate unresponsive clients.
// ═══════════════════════════════════════════════════════════════

import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface PriceTick {
  listingId: string;
  slug: string;
  name: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  timestamp?: number;
}

const REDIS_CHANNEL = "nexusx:prices";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────
// WEBSOCKET PRICE SERVER
// ─────────────────────────────────────────────────────────────

export class PriceWebSocketServer {
  private wss: WebSocketServer | null = null;
  private redisSub: Redis;
  private snapshotCache: Map<string, PriceTick> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private aliveMap: WeakMap<WebSocket, boolean> = new WeakMap();

  constructor(redisUrl: string) {
    // Dedicated connection in subscribe mode
    this.redisSub = new Redis(redisUrl, { lazyConnect: true });
  }

  /**
   * Attach the WebSocket server to the existing HTTP server.
   * Call this after `app.listen()` returns the server instance.
   */
  async attach(server: HttpServer): Promise<void> {
    this.wss = new WebSocketServer({ server, path: "/ws/prices" });

    // Connect to Redis and subscribe
    await this.redisSub.connect();
    await this.redisSub.subscribe(REDIS_CHANNEL);

    this.redisSub.on("message", (channel: string, message: string) => {
      if (channel === REDIS_CHANNEL) {
        this.handleRedisMessage(message);
      }
    });

    // Handle new WebSocket connections
    this.wss.on("connection", (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    console.log("[PriceWS] WebSocket price stream attached at /ws/prices");
  }

  /**
   * Clean up everything: close WebSocket server, unsubscribe Redis.
   */
  async destroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }

    // Unsubscribe and disconnect Redis
    try {
      await this.redisSub.unsubscribe(REDIS_CHANNEL);
      await this.redisSub.quit();
    } catch {
      // Redis may already be disconnected
    }

    console.log("[PriceWS] Destroyed.");
  }

  // ─── Connection Handling ───

  private handleConnection(ws: WebSocket): void {
    this.aliveMap.set(ws, true);

    // Send the full snapshot immediately
    const snapshot = Array.from(this.snapshotCache.values());
    if (snapshot.length > 0) {
      ws.send(
        JSON.stringify({ type: "snapshot", ticks: snapshot }),
      );
    }

    // Track pong responses for heartbeat
    ws.on("pong", () => {
      this.aliveMap.set(ws, true);
    });

    ws.on("error", () => {
      // Silently handle — the close event will fire next
    });
  }

  // ─── Redis Message Handling ───

  private handleRedisMessage(message: string): void {
    try {
      const tick: PriceTick = JSON.parse(message);

      // Update snapshot cache
      this.snapshotCache.set(tick.listingId, tick);

      // Broadcast to all connected clients
      const payload = JSON.stringify({ type: "tick", tick });
      this.broadcast(payload);
    } catch (err) {
      console.error("[PriceWS] Failed to parse Redis message:", err);
    }
  }

  // ─── Broadcast ───

  private broadcast(data: string): void {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // ─── Heartbeat ───

  private heartbeat(): void {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (this.aliveMap.get(client) === false) {
        // Client didn't respond to last ping — terminate
        client.terminate();
        continue;
      }
      this.aliveMap.set(client, false);
      client.ping();
    }
  }
}
