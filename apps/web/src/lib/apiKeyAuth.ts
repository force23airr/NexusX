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

import { prisma } from "@/lib/prisma";
import {
  extractBearerApiKey,
  resolveUserFromRawApiKey,
} from "@nexusx/database";
import type { NextRequest } from "next/server";
import type { User, ProviderProfile } from "@prisma/client";

async function lookupUserByApiKey(req: NextRequest): Promise<User | null> {
  const rawKey = extractBearerApiKey(req.headers.get("authorization"));
  if (!rawKey) return null;
  return resolveUserFromRawApiKey(prisma, rawKey);
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
