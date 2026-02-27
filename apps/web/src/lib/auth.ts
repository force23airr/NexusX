import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import type { User, ProviderProfile } from "@prisma/client";

/**
 * Get the current authenticated user from the database.
 * Auto-creates a User + Wallet on first login using Clerk profile data.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // Look up by Clerk externalId
  const existing = await prisma.user.findUnique({
    where: { externalId: userId },
  });
  if (existing) return existing;

  // First login — auto-create from Clerk profile
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email =
    clerkUser.emailAddresses?.[0]?.emailAddress ?? `${userId}@nexusx.dev`;
  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    email.split("@")[0];

  const user = await prisma.user.create({
    data: {
      externalId: userId,
      email,
      displayName,
      avatarUrl: clerkUser.imageUrl ?? null,
      roles: ["BUYER"],
      wallet: {
        create: {
          address: `pending_${userId}`,
          balanceUsdc: 0,
          chainId: 8453,
        },
      },
    },
  });

  return user;
}

/**
 * Get the current authenticated provider profile.
 * Auto-creates ProviderProfile and adds PROVIDER role if missing.
 * Returns null if not authenticated.
 */
export async function getCurrentProvider(): Promise<{
  user: User;
  profile: ProviderProfile;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  let profile = await prisma.providerProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    // Auto-create provider profile
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

/**
 * Require an authenticated user — throws if not signed in.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

/**
 * Require an authenticated provider — throws if not signed in.
 */
export async function requireProvider(): Promise<{
  user: User;
  profile: ProviderProfile;
}> {
  const result = await getCurrentProvider();
  if (!result) {
    throw new Error("Authentication required");
  }
  return result;
}
