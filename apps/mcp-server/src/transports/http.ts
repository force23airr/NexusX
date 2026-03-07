// ═══════════════════════════════════════════════════════════════
// NexusX — MCP HTTP Transport
// apps/mcp-server/src/transports/http.ts
//
// Express server with StreamableHTTPServerTransport for remote
// agents. Supports multiple concurrent sessions, each with
// its own API key from the Authorization header.
// ═══════════════════════════════════════════════════════════════

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID, timingSafeEqual } from "crypto";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const startedAt = Date.now();

interface HttpTransportOptions {
  port: number;
  host: string;
  allowedOrigins: string[];
}

const MAX_HTTP_BODY_BYTES = 1 * 1024 * 1024;

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function allowedOrigin(origin: string | undefined, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  if (allowedOrigins.includes("*")) return "*";
  return allowedOrigins.includes(origin) ? origin : null;
}

/**
 * Start the MCP server on an Express HTTP server.
 * Handles session management and multi-tenant API keys.
 */
export async function startHttpTransport(
  server: McpServer,
  options: HttpTransportOptions,
): Promise<void> {
  const { port, host, allowedOrigins } = options;
  const requiresAuth = !isLoopbackHost(host);
  if (requiresAuth && allowedOrigins.includes("*")) {
    throw new Error("[MCP HTTP] Wildcard CORS is not allowed when binding a non-loopback host.");
  }
  const app = express();
  app.disable("x-powered-by");
  const sessions = new Map<string, SessionEntry>();

  // Parse JSON bodies for MCP protocol messages
  app.use(express.json({ limit: MAX_HTTP_BODY_BYTES }));

  // ─── CORS ───
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = allowedOrigin(req.headers.origin, allowedOrigins);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  // ─── Bearer Token Auth ───
  const authToken = process.env.MCP_AUTH_TOKEN;
  if (requiresAuth && !authToken) {
    throw new Error("[MCP HTTP] MCP_AUTH_TOKEN is required when binding a non-loopback host.");
  }
  if (authToken) {
    app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
      if (req.method === "OPTIONS") return next();
      const bearer = req.headers.authorization?.replace("Bearer ", "");
      if (!bearer) {
        res.status(401).json({ error: "Invalid or missing auth token" });
        return;
      }

      const provided = Buffer.from(bearer);
      const expected = Buffer.from(authToken);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.status(401).json({ error: "Invalid or missing auth token" });
        return;
      }
      next();
    });
    console.error("[MCP HTTP] Auth token required for /mcp endpoint");
  }

  // ─── MCP Endpoint ───
  app.all("/mcp", async (req: Request, res: Response) => {
    // Get or create session
    let sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST" && !sessionId) {
      // New session — create transport
      sessionId = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId!,
        onsessioninitialized: (id) => {
          console.error(`[MCP HTTP] Session initialized: ${id}`);
        },
      });

      sessions.set(sessionId, {
        transport,
        lastActivity: Date.now(),
      });

      // Connect server to this transport
      await server.connect(transport);
    }

    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      res.status(400).json({ error: "Invalid or missing session. Send a POST to /mcp to start a new session." });
      return;
    }

    session.lastActivity = Date.now();

    // Delegate to the transport
    await session.transport.handleRequest(req, res, req.body);
  });

  // ─── Session Cleanup on DELETE ───
  app.delete("/mcp", (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.transport.close();
      sessions.delete(sessionId);
      res.status(200).json({ message: "Session closed." });
    } else {
      res.status(404).json({ error: "Session not found." });
    }
  });

  // ─── Health Check ───
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      transport: "http",
      activeSessions: sessions.size,
      authEnabled: !!authToken,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      endpoint: `http://${host}:${port}/mcp`,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Idle Session Cleanup ───
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
        session.transport.close();
        sessions.delete(id);
        console.error(`[MCP HTTP] Cleaned up idle session: ${id}`);
      }
    }
  }, 60_000);

  // ─── Start ───
  app.listen(port, host, () => {
    console.error(`[MCP] HTTP transport listening on ${host}:${port}`);
    console.error(`[MCP] Endpoint: http://${host}:${port}/mcp`);
    console.error(`[MCP] Health:   http://${host}:${port}/health`);
  });
}
