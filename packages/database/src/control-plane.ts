import type { Prisma, PrismaClient } from "@prisma/client";

export const GATEWAY_ROUTE_VERSION_KEY = "gateway.route-version";
export const GATEWAY_LISTING_DEGRADATION_VERSION_KEY = "gateway.listing-degradation-version";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

function parseVersion(value: Prisma.JsonValue | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).version;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(0, Math.trunc(candidate));
    }
  }

  return 0;
}

export async function getControlPlaneVersion(
  prisma: PrismaLike,
  key: string = GATEWAY_ROUTE_VERSION_KEY,
): Promise<number> {
  const record = await prisma.platformConfig.findUnique({
    where: { key },
    select: { value: true },
  });

  return parseVersion(record?.value);
}

export async function bumpControlPlaneVersion(
  prisma: PrismaLike,
  key: string = GATEWAY_ROUTE_VERSION_KEY,
): Promise<number> {
  const bumpInTx = async (tx: Prisma.TransactionClient): Promise<number> => {
    const current = await tx.platformConfig.findUnique({
      where: { key },
      select: { value: true },
    });
    const nextVersion = parseVersion(current?.value) + 1;

    await tx.platformConfig.upsert({
      where: { key },
      create: {
        key,
        value: { version: nextVersion } as Prisma.InputJsonValue,
      },
      update: {
        value: { version: nextVersion } as Prisma.InputJsonValue,
      },
    });

    return nextVersion;
  };

  if ("$transaction" in prisma) {
    return prisma.$transaction((tx) => bumpInTx(tx));
  }

  return bumpInTx(prisma);
}
