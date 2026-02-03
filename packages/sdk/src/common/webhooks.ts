// ═══════════════════════════════════════════════════════════════
// NexusX — Webhook Utilities
// packages/sdk/src/common/webhooks.ts
//
// Utilities for providers to verify and handle incoming
// webhooks from the NexusX platform:
//   - HMAC-SHA256 signature verification
//   - Payload parsing and validation
//   - Event handler registry
//   - Express/Node middleware helper
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookEventType, WebhookPayload } from "../provider/types";

// ─────────────────────────────────────────────────────────────
// SIGNATURE VERIFICATION
// ─────────────────────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature on an incoming webhook.
 *
 * @param rawBody   Raw request body (string or Buffer).
 * @param signature Signature from the `X-NexusX-Signature` header.
 * @param secret    Shared secret registered with the webhook.
 * @returns True if valid, false if tampered or invalid.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  try {
    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");

    if (expectedBuf.length !== signatureBuf.length) return false;

    return timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}

/**
 * Compute the HMAC-SHA256 signature for a payload.
 * Used by the platform when sending webhooks.
 */
export function signPayload(payload: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ─────────────────────────────────────────────────────────────
// PAYLOAD PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Parse and validate an incoming webhook payload.
 *
 * @param rawBody   Raw request body string.
 * @param signature X-NexusX-Signature header value.
 * @param secret    Shared secret for verification.
 * @returns Parsed WebhookPayload.
 * @throws Error if signature is invalid or payload is malformed.
 */
export function parseWebhookPayload<T = unknown>(
  rawBody: string,
  signature: string,
  secret: string
): WebhookPayload<T> {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new Error("Invalid webhook signature. Possible tampering.");
  }

  const payload = JSON.parse(rawBody) as WebhookPayload<T>;

  if (!payload.eventId || !payload.type || !payload.timestamp) {
    throw new Error("Malformed webhook payload: missing required fields.");
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────
// EVENT HANDLER REGISTRY
// ─────────────────────────────────────────────────────────────

type EventHandler<T = unknown> = (payload: WebhookPayload<T>) => void | Promise<void>;

/**
 * Registry for webhook event handlers.
 *
 * Usage:
 *   const handler = new WebhookHandler(mySecret);
 *   handler.on("transaction.completed", async (payload) => { ... });
 *   handler.on("price.updated", async (payload) => { ... });
 *
 *   // In your Express route:
 *   app.post("/webhooks/nexusx", async (req, res) => {
 *     await handler.handle(req.body, req.headers["x-nexusx-signature"]);
 *     res.status(200).send("ok");
 *   });
 */
export class WebhookHandler {
  private secret: string;
  private handlers: Map<string, EventHandler[]> = new Map();
  private catchAllHandlers: EventHandler[] = [];
  private processedEvents: Set<string> = new Set();
  private maxProcessedSize: number;

  constructor(secret: string, maxIdempotencySize: number = 10_000) {
    this.secret = secret;
    this.maxProcessedSize = maxIdempotencySize;
  }

  /**
   * Register a handler for a specific event type.
   */
  on<T = unknown>(eventType: WebhookEventType, handler: EventHandler<T>): this {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
    return this;
  }

  /**
   * Register a catch-all handler for any event type.
   */
  onAny(handler: EventHandler): this {
    this.catchAllHandlers.push(handler);
    return this;
  }

  /**
   * Process an incoming webhook.
   *
   * @param rawBody   Raw request body (string).
   * @param signature X-NexusX-Signature header value.
   * @returns The parsed payload if processed, null if duplicate.
   * @throws Error if signature is invalid.
   */
  async handle(rawBody: string, signature: string): Promise<WebhookPayload | null> {
    const payload = parseWebhookPayload(rawBody, signature, this.secret);

    // Idempotency check.
    if (this.processedEvents.has(payload.eventId)) {
      return null;
    }
    this.markProcessed(payload.eventId);

    // Run type-specific handlers.
    const typeHandlers = this.handlers.get(payload.type) || [];
    for (const handler of typeHandlers) {
      await handler(payload);
    }

    // Run catch-all handlers.
    for (const handler of this.catchAllHandlers) {
      await handler(payload);
    }

    return payload;
  }

  /**
   * Check if an event was already processed (idempotency).
   */
  wasProcessed(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  private markProcessed(eventId: string): void {
    this.processedEvents.add(eventId);
    // Evict oldest entries if the set grows too large.
    if (this.processedEvents.size > this.maxProcessedSize) {
      const iterator = this.processedEvents.values();
      const oldest = iterator.next().value;
      if (oldest) this.processedEvents.delete(oldest);
    }
  }
}
