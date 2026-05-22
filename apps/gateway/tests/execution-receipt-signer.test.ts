import { generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decodeReceiptSigningPrivateKey,
  ExecutionReceiptSigner,
} from "../src/services/executionReceiptSigner";

describe("ExecutionReceiptSigner", () => {
  it("signs deterministic Ed25519 receipt payloads", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const signer = new ExecutionReceiptSigner({
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      signerId: "gateway-test",
    });

    const receipt = signer.sign({
      requestId: "req_001",
      listingId: "lst_001",
      listingSlug: "test-api",
      authMode: "API_KEY",
      billingMode: "INDIVIDUAL",
      outcome: "SUCCESS",
      settlementStatus: "NONE",
      quotedPriceUsdc: 0.005,
      chargedPriceUsdc: 0.005,
      platformFeeUsdc: 0.0006,
      providerAmountUsdc: 0.0044,
      httpStatus: 200,
      upstreamStatus: 200,
      latencyMs: 12.8,
      bytesTransferred: 11,
      txHash: null,
      responseBody: Buffer.from("hello world"),
    });

    expect(receipt.algorithm).toBe("ed25519");
    expect(receipt.signer).toBe("gateway-test");
    expect(receipt.responseHash).toHaveLength(64);
    expect(receipt.payloadHash).toHaveLength(64);
    expect(receipt.signature.length).toBeGreaterThan(80);
    expect(receipt.payload.responseHash).toBe(receipt.responseHash);
    expect(signer.verify(receipt)).toBe(true);
  });

  it("canonicalizes object keys before hashing", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("decodes base64 PEM env values", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n";
    const encoded = Buffer.from(pem, "utf8").toString("base64");

    expect(decodeReceiptSigningPrivateKey(encoded)).toBe(pem);
  });
});
