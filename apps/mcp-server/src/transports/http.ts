// ═══════════════════════════════════════════════════════════════
// NexusX — MCP HTTP Transport
// apps/mcp-server/src/transports/http.ts
//
// Express server with StreamableHTTPServerTransport for remote
// agents. Supports multiple concurrent sessions, each with
// its own API key from the Authorization header.
// ═══════════════════════════════════════════════════════════════

import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Start the MCP server on an Express HTTP server.
 * Handles session management and multi-tenant API keys.
 */
export async function startHttpTransport(
  server: McpServer,
  port: number,
): Promise<void> {
  const app = express();
  const sessions = new Map<string, SessionEntry>();

  // Parse JSON bodies for MCP protocol messages
  app.use(express.json());

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
  app.listen(port, () => {
    console.error(`[MCP] HTTP transport listening on port ${port}`);
    console.error(`[MCP] Endpoint: http://localhost:${port}/mcp`);
  });
}
