// ═══════════════════════════════════════════════════════════════
// NexusX — API Key Auth for Provider Routes
// apps/web/src/lib/apiKeyAuth.ts
//
// Authenticates CLI/programmatic requests via the existing
// ApiKey model (same keys used by the gateway). Enables
// `npx nexusx deploy` without Clerk browser session.
//
// Key format: nxs_{8-char-prefix}_{28-char-random}
// ═══════════════════════════════════════════════════════════════

import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import type { User, ProviderProfile } from "@prisma/client";

async function lookupUserByApiKey(req: NextRequest): Promise<User | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer nxs_")) return null;

  const rawKey = authHeader.slice(7);
  if (rawKey.length < 12) return null;

  const prefix = rawKey.slice(4, 12);
  const key = await prisma.apiKey.findFirst({
    where: { keyPrefix: prefix },
    include: { user: true },
  });

  if (!key) return null;

  const hash = createHash("sha256").update(rawKey).digest("hex");
  if (!timingSafeEqual(Buffer.from(hash), Buffer.from(key.keyHash))) return null;
  if (key.status !== "ACTIVE") return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

  return key.user;
}

export async function getUserFromApiKey(req: NextRequest): Promise<User | null> {
  return lookupUserByApiKey(req);
}

/**
 * Authenticate a provider via API key in the Authorization header.
 * Returns null if no valid API key is present (caller should fall back to Clerk).
 */
export async function getProviderFromApiKey(
  req: NextRequest
): Promise<{ user: User; profile: ProviderProfile } | null> {
  const user = await lookupUserByApiKey(req);
  if (!user) return null;

  // Ensure provider profile exists (auto-create if needed)
  let profile = await prisma.providerProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    profile = await prisma.providerProfile.create({
      data: { userId: user.id },
    });

    // Add PROVIDER role if not already present
    if (!user.roles.includes("PROVIDER")) {
      await prisma.user.update({
        where: { id: user.id },
        data: { roles: { push: "PROVIDER" } },
      });
    }
  }

  return { user, profile };
}
