import type {
  Listing,
  ListingOperationVerificationRun,
  OperationVerificationStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export const OPERATION_VERIFICATION_STALE_HOURS = 24 * 14;
const OPERATION_VERIFICATION_STALE_MS =
  OPERATION_VERIFICATION_STALE_HOURS * 60 * 60 * 1000;

export interface ListingOperationVerificationSummarySnapshot {
  status: OperationVerificationStatus | "STALE";
  rawStatus: OperationVerificationStatus;
  stale: boolean;
  lastVerifiedAt: string | null;
  lastSuccessfulVerifiedAt: string | null;
  verifiedCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
  staleAfterHours: number;
}

export interface ListingOperationVerificationRunSnapshot {
  id: string;
  status: OperationVerificationStatus | "STALE";
  rawStatus: OperationVerificationStatus;
  stale: boolean;
  verifiedCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
}

export interface PersistListingOperationVerificationInput {
  listingId: string;
  providerId: string;
  verifiedCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
  results: Prisma.InputJsonValue;
}

type ListingVerificationSummaryFields = Pick<
  Listing,
  | "operationVerificationStatus"
  | "lastOperationVerificationAt"
  | "lastSuccessfulOperationVerificationAt"
  | "operationVerificationVerifiedCount"
  | "operationVerificationWarningCount"
  | "operationVerificationFailedCount"
  | "operationVerificationSkippedCount"
>;

function deriveStoredOperationVerificationStatus(input: {
  verifiedCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
}): OperationVerificationStatus {
  if (input.failedCount > 0) return "FAILED";
  if (input.warningCount > 0 || input.skippedCount > 0) return "WARNING";
  if (input.verifiedCount > 0) return "VERIFIED";
  return "NONE";
}

export function isOperationVerificationStale(
  value: Date | null | undefined,
  now = Date.now(),
): boolean {
  if (!value) return false;
  return now - value.getTime() > OPERATION_VERIFICATION_STALE_MS;
}

export function buildListingOperationVerificationSummary(
  listing: ListingVerificationSummaryFields,
): ListingOperationVerificationSummarySnapshot {
  const stale = isOperationVerificationStale(listing.lastOperationVerificationAt);
  return {
    status: stale ? "STALE" : listing.operationVerificationStatus,
    rawStatus: listing.operationVerificationStatus,
    stale,
    lastVerifiedAt: listing.lastOperationVerificationAt?.toISOString() ?? null,
    lastSuccessfulVerifiedAt:
      listing.lastSuccessfulOperationVerificationAt?.toISOString() ?? null,
    verifiedCount: listing.operationVerificationVerifiedCount,
    warningCount: listing.operationVerificationWarningCount,
    failedCount: listing.operationVerificationFailedCount,
    skippedCount: listing.operationVerificationSkippedCount,
    staleAfterHours: OPERATION_VERIFICATION_STALE_HOURS,
  };
}

function buildRunSnapshot(
  run: Pick<
    ListingOperationVerificationRun,
    | "id"
    | "status"
    | "verifiedCount"
    | "warningCount"
    | "failedCount"
    | "skippedCount"
    | "createdAt"
  >,
): ListingOperationVerificationRunSnapshot {
  const stale = isOperationVerificationStale(run.createdAt);
  return {
    id: run.id,
    status: stale ? "STALE" : run.status,
    rawStatus: run.status,
    stale,
    verifiedCount: run.verifiedCount,
    warningCount: run.warningCount,
    failedCount: run.failedCount,
    skippedCount: run.skippedCount,
    createdAt: run.createdAt.toISOString(),
  };
}

export async function persistListingOperationVerificationRun(
  prisma: PrismaClient,
  input: PersistListingOperationVerificationInput,
): Promise<{
  summary: ListingOperationVerificationSummarySnapshot;
  run: ListingOperationVerificationRunSnapshot;
}> {
  const status = deriveStoredOperationVerificationStatus(input);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const current = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: {
        lastSuccessfulOperationVerificationAt: true,
      },
    });

    const run = await tx.listingOperationVerificationRun.create({
      data: {
        listingId: input.listingId,
        providerId: input.providerId,
        status,
        verifiedCount: input.verifiedCount,
        warningCount: input.warningCount,
        failedCount: input.failedCount,
        skippedCount: input.skippedCount,
        results: input.results,
      },
      select: {
        id: true,
        status: true,
        verifiedCount: true,
        warningCount: true,
        failedCount: true,
        skippedCount: true,
        createdAt: true,
      },
    });

    const updatedListing = await tx.listing.update({
      where: { id: input.listingId },
      data: {
        operationVerificationStatus: status,
        lastOperationVerificationAt: now,
        lastSuccessfulOperationVerificationAt:
          status === "VERIFIED"
            ? now
            : current?.lastSuccessfulOperationVerificationAt ?? null,
        operationVerificationVerifiedCount: input.verifiedCount,
        operationVerificationWarningCount: input.warningCount,
        operationVerificationFailedCount: input.failedCount,
        operationVerificationSkippedCount: input.skippedCount,
      },
      select: {
        operationVerificationStatus: true,
        lastOperationVerificationAt: true,
        lastSuccessfulOperationVerificationAt: true,
        operationVerificationVerifiedCount: true,
        operationVerificationWarningCount: true,
        operationVerificationFailedCount: true,
        operationVerificationSkippedCount: true,
      },
    });

    return {
      summary: buildListingOperationVerificationSummary(updatedListing),
      run: buildRunSnapshot(run),
    };
  });
}

export async function getListingOperationVerificationHistory(
  prisma: PrismaClient,
  input: {
    listingId: string;
    limit?: number;
  },
): Promise<ListingOperationVerificationRunSnapshot[]> {
  const runs = await prisma.listingOperationVerificationRun.findMany({
    where: { listingId: input.listingId },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 10,
    select: {
      id: true,
      status: true,
      verifiedCount: true,
      warningCount: true,
      failedCount: true,
      skippedCount: true,
      createdAt: true,
    },
  });

  return runs.map(buildRunSnapshot);
}
