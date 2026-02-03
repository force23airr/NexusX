// ═══════════════════════════════════════════════════════════════
// NexusX — Prisma Client Singleton
// packages/database/src/client.ts
//
// Shared Prisma client instance for all services. Uses the
// singleton pattern to prevent multiple connections in dev
// (Next.js hot reload) and provides a clean shutdown hook.
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Singleton Prisma client.
 *
 * In development, the instance is stored on `globalThis` to
 * survive Next.js hot reloads without leaking connections.
 * In production, a fresh instance is created once per process.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
    datasourceUrl: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Graceful shutdown — disconnect Prisma when the process exits.
 * Call from your server's shutdown handler.
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log("[Database] Prisma client disconnected.");
}

/**
 * Health check — verify the database connection is alive.
 * Returns latency in milliseconds.
 */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  message?: string;
}> {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// Auto-register shutdown hook.
process.on("beforeExit", async () => {
  await disconnectDatabase();
});
