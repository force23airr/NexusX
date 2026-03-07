import { createHash, timingSafeEqual } from "crypto";
import type { PrismaClient, User } from "@prisma/client";

const API_KEY_PATTERN = /^nxs_[a-z0-9]{8}_[a-z0-9]{28}$/;

export function isValidApiKeyFormat(rawKey: string): boolean {
  return API_KEY_PATTERN.test(rawKey);
}

export function extractApiKeyPrefix(rawKey: string): string | null {
  if (!isValidApiKeyFormat(rawKey)) {
    return null;
  }
  return rawKey.slice(4, 12);
}

export function extractBearerApiKey(authHeader: string | null | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const rawKey = authHeader.slice(7).trim();
  return isValidApiKeyFormat(rawKey) ? rawKey : null;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function verifyApiKeyHash(rawKey: string, expectedHash: string): boolean {
  const provided = Buffer.from(hashApiKey(rawKey));
  const expected = Buffer.from(expectedHash);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function resolveUserFromRawApiKey(
  prisma: PrismaClient,
  rawKey: string,
): Promise<User | null> {
  const prefix = extractApiKeyPrefix(rawKey);
  if (!prefix) {
    return null;
  }

  const key = await prisma.apiKey.findFirst({
    where: {
      keyPrefix: prefix,
      status: "ACTIVE",
    },
    include: { user: true },
  });

  if (!key) return null;
  if (!verifyApiKeyHash(rawKey, key.keyHash)) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

  return key.user;
}

export async function resolveUserIdFromRawApiKey(
  prisma: PrismaClient,
  rawKey: string,
): Promise<string | null> {
  const prefix = extractApiKeyPrefix(rawKey);
  if (!prefix) {
    return null;
  }

  const key = await prisma.apiKey.findFirst({
    where: {
      keyPrefix: prefix,
      status: "ACTIVE",
    },
    select: {
      userId: true,
      keyHash: true,
      expiresAt: true,
    },
  });

  if (!key) return null;
  if (!verifyApiKeyHash(rawKey, key.keyHash)) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

  return key.userId;
}
