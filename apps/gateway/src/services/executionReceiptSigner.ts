import { createHash, createPrivateKey, createPublicKey, sign, verify } from "crypto";
import type {
  ExecutionReceiptSignatureInput,
  SignedExecutionReceipt,
} from "../types";

export interface ExecutionReceiptSignerConfig {
  privateKeyPem: string;
  signerId: string;
}

export class ExecutionReceiptSigner {
  private readonly privateKey: ReturnType<typeof createPrivateKey>;
  private readonly publicKey: ReturnType<typeof createPublicKey>;
  private readonly signerId: string;

  constructor(config: ExecutionReceiptSignerConfig) {
    const privateKeyPem = config.privateKeyPem.trim();
    if (!privateKeyPem) {
      throw new Error("Receipt signing private key is required.");
    }

    this.privateKey = createPrivateKey(privateKeyPem);
    this.publicKey = createPublicKey(this.privateKey);
    this.signerId = config.signerId.trim() || "nexusx-gateway";
  }

  sign(input: ExecutionReceiptSignatureInput): SignedExecutionReceipt {
    const responseHash = sha256Hex(input.responseBody);
    const payload = buildReceiptPayload(input, responseHash);
    const canonicalPayload = canonicalJson(payload);
    const payloadHash = sha256Hex(Buffer.from(canonicalPayload, "utf8"));
    const signature = sign(null, Buffer.from(canonicalPayload, "utf8"), this.privateKey)
      .toString("base64url");

    return {
      version: 1,
      algorithm: "ed25519",
      signer: this.signerId,
      responseHash,
      payloadHash,
      signature,
      payload,
    };
  }

  verify(receipt: SignedExecutionReceipt): boolean {
    const canonicalPayload = canonicalJson(receipt.payload);
    const payloadHash = sha256Hex(Buffer.from(canonicalPayload, "utf8"));

    if (payloadHash !== receipt.payloadHash) {
      return false;
    }

    return verify(
      null,
      Buffer.from(canonicalPayload, "utf8"),
      this.publicKey,
      Buffer.from(receipt.signature, "base64url"),
    );
  }
}

export function decodeReceiptSigningPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }

  try {
    return Buffer.from(trimmed, "base64").toString("utf8").replace(/\\n/g, "\n");
  } catch {
    return trimmed;
  }
}

export function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function buildReceiptPayload(
  input: ExecutionReceiptSignatureInput,
  responseHash: string,
): Record<string, unknown> {
  return {
    version: 1,
    requestId: input.requestId,
    listingId: input.listingId ?? null,
    listingSlug: input.listingSlug,
    authMode: input.authMode,
    billingMode: input.billingMode,
    outcome: input.outcome,
    settlementStatus: input.settlementStatus,
    quotedPriceUsdc: roundUsdc(input.quotedPriceUsdc),
    chargedPriceUsdc: roundUsdc(input.chargedPriceUsdc),
    platformFeeUsdc: roundUsdc(input.platformFeeUsdc),
    providerAmountUsdc: roundUsdc(input.providerAmountUsdc),
    httpStatus: input.httpStatus,
    upstreamStatus: input.upstreamStatus ?? null,
    latencyMs: Math.max(0, Math.trunc(input.latencyMs)),
    bytesTransferred: input.bytesTransferred ?? null,
    txHash: input.txHash ?? null,
    responseHash,
  };
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortCanonical);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const child = input[key];
      if (typeof child !== "undefined") {
        acc[key] = sortCanonical(child);
      }
      return acc;
    }, {});
}

function roundUsdc(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}
