import {
  Prisma,
  type PrismaClient,
  type ExecutionAuthMode,
  type ExecutionReceiptOutcome,
  type ExecutionSettlementStatus,
  type TransactionBillingMode,
} from "@prisma/client";

export interface ExecutionReceiptRecord {
  requestId: string;
  queryLogId?: string | null;
  listingId?: string | null;
  operationId?: string | null;
  fallbackSourceReceiptId?: string | null;
  listingSlug: string;
  buyerId?: string | null;
  payerAddress?: string | null;
  callerCountry?: string | null;
  callerRegionBucket?: string | null;
  authMode: ExecutionAuthMode;
  billingMode: TransactionBillingMode;
  outcome: ExecutionReceiptOutcome;
  settlementStatus: ExecutionSettlementStatus;
  sandbox?: boolean;
  quotedPriceUsdc?: number | null;
  chargedPriceUsdc?: number;
  platformFeeUsdc?: number;
  providerAmountUsdc?: number;
  httpStatus: number;
  upstreamStatus?: number | null;
  latencyMs?: number | null;
  bytesTransferred?: number | null;
  bundleSessionId?: string | null;
  bundleStepIndex?: number | null;
  txHash?: string | null;
  circuitState?: string | null;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PersistedExecutionReceiptRef {
  id: string;
  requestId: string;
}

export interface ExecutionReceiptSettlementUpdate {
  requestId: string;
  settlementStatus: ExecutionSettlementStatus;
  chargedPriceUsdc?: number;
  platformFeeUsdc?: number;
  providerAmountUsdc?: number;
  txHash?: string | null;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

function toUsdcDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Prisma.Decimal(value.toFixed(6));
}

function toJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue {
  if (!value) {
    return {} as Prisma.InputJsonValue;
  }
  return value as Prisma.InputJsonValue;
}

function sanitizeNullableString(value: string | null | undefined, max = 1000): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}

export async function persistExecutionReceipt(
  prisma: PrismaClient,
  record: ExecutionReceiptRecord,
): Promise<PersistedExecutionReceiptRef> {
  const saved = await prisma.executionReceipt.upsert({
    where: { requestId: record.requestId },
    create: {
      requestId: record.requestId,
      queryLogId: record.queryLogId ?? null,
      listingId: record.listingId ?? null,
      operationId: sanitizeNullableString(record.operationId, 128),
      fallbackSourceReceiptId: sanitizeNullableString(record.fallbackSourceReceiptId, 64),
      listingSlug: record.listingSlug,
      buyerId: record.buyerId ?? null,
      payerAddress: record.payerAddress ?? null,
      callerCountry: sanitizeNullableString(record.callerCountry, 8),
      callerRegionBucket: sanitizeNullableString(record.callerRegionBucket, 32),
      authMode: record.authMode,
      billingMode: record.billingMode,
      outcome: record.outcome,
      settlementStatus: record.settlementStatus,
      sandbox: record.sandbox ?? false,
      quotedPriceUsdc: toUsdcDecimal(record.quotedPriceUsdc),
      chargedPriceUsdc: toUsdcDecimal(record.chargedPriceUsdc) ?? new Prisma.Decimal("0"),
      platformFeeUsdc: toUsdcDecimal(record.platformFeeUsdc) ?? new Prisma.Decimal("0"),
      providerAmountUsdc: toUsdcDecimal(record.providerAmountUsdc) ?? new Prisma.Decimal("0"),
      httpStatus: record.httpStatus,
      upstreamStatus: record.upstreamStatus ?? null,
      latencyMs: record.latencyMs ?? null,
      bytesTransferred: record.bytesTransferred ?? null,
      bundleSessionId: record.bundleSessionId ?? null,
      bundleStepIndex: record.bundleStepIndex ?? null,
      txHash: sanitizeNullableString(record.txHash, 256),
      circuitState: sanitizeNullableString(record.circuitState, 64),
      retryCount: Math.max(0, record.retryCount ?? 0),
      errorCode: sanitizeNullableString(record.errorCode, 128),
      errorMessage: sanitizeNullableString(record.errorMessage),
      metadata: toJsonValue(record.metadata),
    },
    update: {
      queryLogId: record.queryLogId ?? null,
      listingId: record.listingId ?? null,
      operationId: sanitizeNullableString(record.operationId, 128),
      fallbackSourceReceiptId: sanitizeNullableString(record.fallbackSourceReceiptId, 64),
      listingSlug: record.listingSlug,
      buyerId: record.buyerId ?? null,
      payerAddress: record.payerAddress ?? null,
      callerCountry: sanitizeNullableString(record.callerCountry, 8),
      callerRegionBucket: sanitizeNullableString(record.callerRegionBucket, 32),
      authMode: record.authMode,
      billingMode: record.billingMode,
      outcome: record.outcome,
      settlementStatus: record.settlementStatus,
      sandbox: record.sandbox ?? false,
      quotedPriceUsdc: toUsdcDecimal(record.quotedPriceUsdc),
      chargedPriceUsdc: toUsdcDecimal(record.chargedPriceUsdc) ?? new Prisma.Decimal("0"),
      platformFeeUsdc: toUsdcDecimal(record.platformFeeUsdc) ?? new Prisma.Decimal("0"),
      providerAmountUsdc: toUsdcDecimal(record.providerAmountUsdc) ?? new Prisma.Decimal("0"),
      httpStatus: record.httpStatus,
      upstreamStatus: record.upstreamStatus ?? null,
      latencyMs: record.latencyMs ?? null,
      bytesTransferred: record.bytesTransferred ?? null,
      bundleSessionId: record.bundleSessionId ?? null,
      bundleStepIndex: record.bundleStepIndex ?? null,
      txHash: sanitizeNullableString(record.txHash, 256),
      circuitState: sanitizeNullableString(record.circuitState, 64),
      retryCount: Math.max(0, record.retryCount ?? 0),
      errorCode: sanitizeNullableString(record.errorCode, 128),
      errorMessage: sanitizeNullableString(record.errorMessage),
      metadata: toJsonValue(record.metadata),
    },
    select: {
      id: true,
      requestId: true,
    },
  });

  return saved;
}

export async function updateExecutionReceiptSettlement(
  prisma: PrismaClient,
  input: ExecutionReceiptSettlementUpdate,
): Promise<boolean> {
  const data: Prisma.ExecutionReceiptUpdateManyMutationInput = {
    settlementStatus: input.settlementStatus,
  };

  if (typeof input.chargedPriceUsdc === "number" && Number.isFinite(input.chargedPriceUsdc)) {
    data.chargedPriceUsdc = toUsdcDecimal(input.chargedPriceUsdc) ?? undefined;
  }
  if (typeof input.platformFeeUsdc === "number" && Number.isFinite(input.platformFeeUsdc)) {
    data.platformFeeUsdc = toUsdcDecimal(input.platformFeeUsdc) ?? undefined;
  }
  if (typeof input.providerAmountUsdc === "number" && Number.isFinite(input.providerAmountUsdc)) {
    data.providerAmountUsdc = toUsdcDecimal(input.providerAmountUsdc) ?? undefined;
  }
  if (input.txHash !== undefined) {
    data.txHash = sanitizeNullableString(input.txHash, 256);
  }
  if (typeof input.retryCount === "number" && Number.isFinite(input.retryCount)) {
    data.retryCount = Math.max(0, Math.trunc(input.retryCount));
  }
  if (input.errorCode !== undefined) {
    data.errorCode = sanitizeNullableString(input.errorCode, 128);
  }
  if (input.errorMessage !== undefined) {
    data.errorMessage = sanitizeNullableString(input.errorMessage);
  }
  if (input.metadata !== undefined) {
    data.metadata = toJsonValue(input.metadata);
  }

  const result = await prisma.executionReceipt.updateMany({
    where: { requestId: input.requestId },
    data,
  });

  return result.count > 0;
}
