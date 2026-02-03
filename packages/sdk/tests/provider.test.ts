// ═══════════════════════════════════════════════════════════════
// NexusX — Provider SDK Tests
// packages/sdk/tests/provider.test.ts
//
// Tests for:
//   - Listing input validation
//   - Webhook HMAC-SHA256 verification
//   - Webhook handler event dispatch
//   - Webhook idempotency
//   - Metric report validation
//   - Client initialization
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NexusXProvider } from "../src/provider/client";
import {
  WebhookHandler,
  verifyWebhookSignature,
  signPayload,
  parseWebhookPayload,
} from "../src/common/webhooks";
import type {
  CreateListingInput,
  HealthMetricReport,
  WebhookPayload,
} from "../src/provider/types";

// ─────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────

function makeProvider(): NexusXProvider {
  return new NexusXProvider({
    baseUrl: "https://api.nexusx.io",
    apiKey: "nxs_prov_test1234567890abcdef",
  });
}

function validListingInput(): CreateListingInput {
  return {
    slug: "my-test-api",
    name: "My Test API",
    description: "A comprehensive test API for unit testing the Provider SDK.",
    categorySlug: "nlp",
    listingType: "REST_API",
    baseUrl: "https://api.myservice.com/v1",
    floorPriceUsdc: 0.001,
    capacityPerMinute: 100,
    tags: ["nlp", "testing"],
  };
}

function makeWebhookPayload(eventId: string, type: string): WebhookPayload {
  return {
    eventId,
    type: type as any,
    timestamp: new Date().toISOString(),
    data: { listingId: "lst_001", price: "0.005" },
  };
}

// ─────────────────────────────────────────────────────────────
// CLIENT INITIALIZATION
// ─────────────────────────────────────────────────────────────

describe("NexusXProvider Initialization", () => {
  it("creates a client with valid config", () => {
    const provider = makeProvider();
    expect(provider).toBeDefined();
  });

  it("throws if apiKey is missing", () => {
    expect(() => new NexusXProvider({ baseUrl: "https://api.nexusx.io", apiKey: "" }))
      .toThrow("requires both apiKey and baseUrl");
  });

  it("throws if baseUrl is missing", () => {
    expect(() => new NexusXProvider({ baseUrl: "", apiKey: "nxs_prov_test" }))
      .toThrow("requires both apiKey and baseUrl");
  });
});

// ─────────────────────────────────────────────────────────────
// LISTING VALIDATION
// ─────────────────────────────────────────────────────────────

describe("Listing Input Validation", () => {
  let provider: NexusXProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  it("rejects slug with uppercase letters", async () => {
    const input = { ...validListingInput(), slug: "My-API" };
    await expect(provider.createListing(input)).rejects.toThrow("slug must be lowercase");
  });

  it("rejects slug that is too short", async () => {
    const input = { ...validListingInput(), slug: "ab" };
    await expect(provider.createListing(input)).rejects.toThrow("3-64 characters");
  });

  it("rejects slug starting with hyphen", async () => {
    const input = { ...validListingInput(), slug: "-my-api" };
    await expect(provider.createListing(input)).rejects.toThrow("slug must be lowercase");
  });

  it("rejects name that is too short", async () => {
    const input = { ...validListingInput(), name: "AB" };
    await expect(provider.createListing(input)).rejects.toThrow("name must be at least 3");
  });

  it("rejects description that is too short", async () => {
    const input = { ...validListingInput(), description: "Too short" };
    await expect(provider.createListing(input)).rejects.toThrow("description must be at least 20");
  });

  it("rejects non-HTTPS base URL", async () => {
    const input = { ...validListingInput(), baseUrl: "http://api.myservice.com" };
    await expect(provider.createListing(input)).rejects.toThrow("must use HTTPS");
  });

  it("rejects zero floor price", async () => {
    const input = { ...validListingInput(), floorPriceUsdc: 0 };
    await expect(provider.createListing(input)).rejects.toThrow("greater than zero");
  });

  it("rejects negative floor price", async () => {
    const input = { ...validListingInput(), floorPriceUsdc: -0.001 };
    await expect(provider.createListing(input)).rejects.toThrow("greater than zero");
  });

  it("rejects ceiling below floor", async () => {
    const input = { ...validListingInput(), floorPriceUsdc: 0.01, ceilingPriceUsdc: 0.005 };
    await expect(provider.createListing(input)).rejects.toThrow("Ceiling price must be greater");
  });

  it("rejects zero capacity", async () => {
    const input = { ...validListingInput(), capacityPerMinute: 0 };
    await expect(provider.createListing(input)).rejects.toThrow("at least 1");
  });
});

// ─────────────────────────────────────────────────────────────
// METRIC VALIDATION
// ─────────────────────────────────────────────────────────────

describe("Health Metric Validation", () => {
  let provider: NexusXProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  it("rejects negative success count", async () => {
    const report: HealthMetricReport = {
      listingIdOrSlug: "my-api",
      successCount: -1,
      failureCount: 0,
      medianLatencyMs: 100,
      p99LatencyMs: 200,
      uptimeMinutes: 5,
      totalMinutes: 5,
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
    };
    await expect(provider.reportMetrics(report)).rejects.toThrow("cannot be negative");
  });

  it("rejects uptime exceeding total minutes", async () => {
    const report: HealthMetricReport = {
      listingIdOrSlug: "my-api",
      successCount: 100,
      failureCount: 0,
      medianLatencyMs: 50,
      p99LatencyMs: 150,
      uptimeMinutes: 10,
      totalMinutes: 5,
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
    };
    await expect(provider.reportMetrics(report)).rejects.toThrow("cannot exceed total minutes");
  });
});

// ─────────────────────────────────────────────────────────────
// WEBHOOK SIGNATURE VERIFICATION
// ─────────────────────────────────────────────────────────────

describe("Webhook Signature Verification", () => {
  const secret = "test-secret-key-that-is-at-least-32-chars-long!!";

  it("verifies a valid signature", () => {
    const body = JSON.stringify({ test: "data" });
    const signature = signPayload(body, secret);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ test: "data" });
    const signature = signPayload(body, secret);
    expect(verifyWebhookSignature('{"test":"tampered"}', signature, secret)).toBe(false);
  });

  it("rejects an invalid signature", () => {
    const body = JSON.stringify({ test: "data" });
    expect(verifyWebhookSignature(body, "invalid-hex-signature", secret)).toBe(false);
  });

  it("rejects empty signature", () => {
    expect(verifyWebhookSignature("body", "", secret)).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifyWebhookSignature("body", "sig", "")).toBe(false);
  });

  it("signPayload produces consistent results", () => {
    const body = "consistent-payload";
    const sig1 = signPayload(body, secret);
    const sig2 = signPayload(body, secret);
    expect(sig1).toBe(sig2);
  });

  it("signPayload produces different results for different payloads", () => {
    const sig1 = signPayload("payload-1", secret);
    const sig2 = signPayload("payload-2", secret);
    expect(sig1).not.toBe(sig2);
  });
});

// ─────────────────────────────────────────────────────────────
// WEBHOOK PAYLOAD PARSING
// ─────────────────────────────────────────────────────────────

describe("Webhook Payload Parsing", () => {
  const secret = "test-secret-key-that-is-at-least-32-chars-long!!";

  it("parses a valid signed payload", () => {
    const payload = makeWebhookPayload("evt_001", "price.updated");
    const body = JSON.stringify(payload);
    const signature = signPayload(body, secret);

    const result = parseWebhookPayload(body, signature, secret);
    expect(result.eventId).toBe("evt_001");
    expect(result.type).toBe("price.updated");
    expect(result.data).toBeDefined();
  });

  it("throws on invalid signature", () => {
    const body = JSON.stringify(makeWebhookPayload("evt_002", "price.updated"));
    expect(() => parseWebhookPayload(body, "bad-sig", secret)).toThrow("Invalid webhook signature");
  });

  it("throws on malformed payload", () => {
    const body = JSON.stringify({ incomplete: true });
    const signature = signPayload(body, secret);
    expect(() => parseWebhookPayload(body, signature, secret)).toThrow("missing required fields");
  });
});

// ─────────────────────────────────────────────────────────────
// WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────

describe("WebhookHandler", () => {
  const secret = "test-secret-key-that-is-at-least-32-chars-long!!";
  let handler: WebhookHandler;

  beforeEach(() => {
    handler = new WebhookHandler(secret);
  });

  it("dispatches events to registered handlers", async () => {
    const received: string[] = [];
    handler.on("price.updated", async (payload) => {
      received.push(payload.eventId);
    });

    const payload = makeWebhookPayload("evt_010", "price.updated");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    await handler.handle(body, sig);
    expect(received).toEqual(["evt_010"]);
  });

  it("dispatches to catch-all handlers", async () => {
    const received: string[] = [];
    handler.onAny(async (payload) => {
      received.push(payload.type);
    });

    const payload = makeWebhookPayload("evt_011", "payout.completed");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    await handler.handle(body, sig);
    expect(received).toEqual(["payout.completed"]);
  });

  it("dispatches to both specific and catch-all handlers", async () => {
    const specific: string[] = [];
    const catchAll: string[] = [];

    handler.on("transaction.completed", async (p) => specific.push(p.eventId));
    handler.onAny(async (p) => catchAll.push(p.eventId));

    const payload = makeWebhookPayload("evt_012", "transaction.completed");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    await handler.handle(body, sig);
    expect(specific).toEqual(["evt_012"]);
    expect(catchAll).toEqual(["evt_012"]);
  });

  it("deduplicates events by eventId (idempotency)", async () => {
    let callCount = 0;
    handler.on("price.updated", async () => { callCount++; });

    const payload = makeWebhookPayload("evt_013", "price.updated");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    await handler.handle(body, sig);
    await handler.handle(body, sig); // Duplicate.
    await handler.handle(body, sig); // Duplicate.

    expect(callCount).toBe(1);
  });

  it("returns null for duplicate events", async () => {
    handler.on("price.updated", async () => {});

    const payload = makeWebhookPayload("evt_014", "price.updated");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    const first = await handler.handle(body, sig);
    const second = await handler.handle(body, sig);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("tracks processed events", async () => {
    const payload = makeWebhookPayload("evt_015", "listing.activated");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    expect(handler.wasProcessed("evt_015")).toBe(false);
    await handler.handle(body, sig);
    expect(handler.wasProcessed("evt_015")).toBe(true);
  });

  it("throws on invalid signature", async () => {
    const body = JSON.stringify(makeWebhookPayload("evt_016", "price.updated"));
    await expect(handler.handle(body, "invalid")).rejects.toThrow("Invalid webhook signature");
  });

  it("supports multiple handlers for same event", async () => {
    const results: number[] = [];
    handler.on("price.updated", async () => results.push(1));
    handler.on("price.updated", async () => results.push(2));

    const payload = makeWebhookPayload("evt_017", "price.updated");
    const body = JSON.stringify(payload);
    const sig = signPayload(body, secret);

    await handler.handle(body, sig);
    expect(results).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────
// WEBHOOK REGISTRATION VALIDATION
// ─────────────────────────────────────────────────────────────

describe("Webhook Registration Validation", () => {
  let provider: NexusXProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  it("rejects non-HTTPS webhook URL", async () => {
    await expect(
      provider.registerWebhook({
        url: "http://my-server.com/webhooks",
        events: ["price.updated"],
        secret: "a".repeat(32),
      })
    ).rejects.toThrow("must use HTTPS");
  });

  it("rejects empty events array", async () => {
    await expect(
      provider.registerWebhook({
        url: "https://my-server.com/webhooks",
        events: [],
        secret: "a".repeat(32),
      })
    ).rejects.toThrow("At least one event");
  });

  it("rejects short secret", async () => {
    await expect(
      provider.registerWebhook({
        url: "https://my-server.com/webhooks",
        events: ["price.updated"],
        secret: "too-short",
      })
    ).rejects.toThrow("at least 32 characters");
  });
});

// ─────────────────────────────────────────────────────────────
// PAYOUT VALIDATION
// ─────────────────────────────────────────────────────────────

describe("Payout Validation", () => {
  let provider: NexusXProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  it("rejects zero payout amount", async () => {
    await expect(
      provider.requestPayout({ amountUsdc: 0 })
    ).rejects.toThrow("greater than zero");
  });

  it("rejects negative payout amount", async () => {
    await expect(
      provider.requestPayout({ amountUsdc: -50 })
    ).rejects.toThrow("greater than zero");
  });
});
