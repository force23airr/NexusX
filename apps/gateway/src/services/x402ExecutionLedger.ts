import { Prisma, type PrismaClient } from "@prisma/client";
import type { X402ExecutionRecord } from "../types";

function toUsdcDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return {} as Prisma.InputJsonValue;
  }
  return value as Prisma.InputJsonValue;
}

export async function persistX402ExecutionRecord(
  prisma: PrismaClient,
  record: X402ExecutionRecord,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const x402SettlementRecord = (tx as any).x402SettlementRecord;
    const existing = await x402SettlementRecord.findUnique({
      where: { requestId: record.requestId },
      select: { status: true },
    });

    await x402SettlementRecord.upsert({
      where: { requestId: record.requestId },
      create: {
        requestId: record.requestId,
        listingId: record.listingId,
        payerAddress: record.payerAddress,
        listingSlug: record.listingSlug,
        paymentHeader: record.status === "SETTLEMENT_PENDING" ? record.paymentHeader ?? null : null,
        paymentHeaderHash: record.paymentHeaderHash,
        paymentRequirement: toJsonValue(record.paymentRequirement),
        status: record.status,
        quotedPriceUsdc: toUsdcDecimal(record.quotedPriceUsdc),
        platformFeeUsdc: toUsdcDecimal(record.platformFeeUsdc),
        providerAmountUsdc: toUsdcDecimal(record.providerAmountUsdc),
        upstreamStatus: record.upstreamStatus ?? null,
        responseTimeMs: record.responseTimeMs ?? null,
        bytesTransferred: record.bytesTransferred ?? null,
        txHash: record.txHash ?? null,
        claimedAt: null,
        availableAt: new Date(),
        lastError: record.status === "SETTLEMENT_PENDING" ? record.lastError ?? null : null,
        settledAt: record.status === "SETTLED" ? new Date() : null,
      },
      update: {
        listingId: record.listingId,
        payerAddress: record.payerAddress,
        listingSlug: record.listingSlug,
        paymentHeader: record.status === "SETTLEMENT_PENDING" ? record.paymentHeader ?? null : null,
        paymentHeaderHash: record.paymentHeaderHash,
        paymentRequirement: toJsonValue(record.paymentRequirement),
        status: record.status,
        quotedPriceUsdc: toUsdcDecimal(record.quotedPriceUsdc),
        platformFeeUsdc: toUsdcDecimal(record.platformFeeUsdc),
        providerAmountUsdc: toUsdcDecimal(record.providerAmountUsdc),
        upstreamStatus: record.upstreamStatus ?? null,
        responseTimeMs: record.responseTimeMs ?? null,
        bytesTransferred: record.bytesTransferred ?? null,
        txHash: record.txHash ?? null,
        claimedAt: null,
        availableAt: new Date(),
        lastError: record.status === "SETTLEMENT_PENDING" ? record.lastError ?? null : null,
        settledAt: record.status === "SETTLED" ? new Date() : null,
      },
    });

    if (record.status === "SETTLED" && existing?.status !== "SETTLED") {
      await tx.listing.update({
        where: { id: record.listingId },
        data: {
          totalCalls: { increment: 1 },
          totalRevenue: { increment: toUsdcDecimal(record.quotedPriceUsdc) },
        },
      });
    }
  });
}
