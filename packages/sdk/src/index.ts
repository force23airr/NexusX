// ═══════════════════════════════════════════════════════════════
// NexusX — Provider SDK Barrel Export
// packages/sdk/src/index.ts
//
// Public API surface:
//   import { NexusXProvider, WebhookHandler, verifyWebhookSignature } from "@nexusx/sdk";
// ═══════════════════════════════════════════════════════════════

// ─── Provider Client ───
export { NexusXProvider } from "./provider/client";

// ─── Webhook Utilities ───
export {
  WebhookHandler,
  verifyWebhookSignature,
  signPayload,
  parseWebhookPayload,
} from "./common/webhooks";

// ─── HTTP Client (for advanced usage) ───
export { HttpClient, NexusXApiError } from "./common/httpClient";

// ─── Types ───
export type {
  // Config
  NexusXProviderConfig,
  // Profile
  ProviderProfile,
  UpdateProfileInput,
  // Listings
  ListingType,
  AuthType,
  CreateListingInput,
  UpdateListingInput,
  Listing,
  // Health
  HealthMetricReport,
  HealthReporterConfig,
  // Webhooks
  WebhookEventType,
  RegisterWebhookInput,
  Webhook,
  WebhookPayload,
  // Payouts
  Payout,
  RequestPayoutInput,
  // Analytics
  ListingAnalytics,
  // Response
  ApiResponse,
  PaginatedResponse,
} from "./provider/types";
