// ═══════════════════════════════════════════════════════════════
// NexusX — Seed Data
// packages/database/prisma/seeds/seed.ts
//
// Seeds the database with realistic marketplace data:
//   - Category taxonomy (3 levels deep)
//   - Users (admin, providers, buyers)
//   - Wallets (Base L2 addresses)
//   - Provider profiles
//   - Listings (7 across all types)
//   - API keys (hashed)
//   - Subscriptions, watchlist items, ratings
//   - Platform configuration
//   - Initial demand signals + quality snapshots
//
// Run: npx prisma db seed
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "crypto";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────
// DETERMINISTIC IDs (for cross-reference stability)
// ─────────────────────────────────────────────────────────────

const ID = {
  // Users
  admin: "00000000-0000-4000-a000-000000000001",
  providerOpenAI: "00000000-0000-4000-a000-000000000010",
  providerAnthropic: "00000000-0000-4000-a000-000000000011",
  providerDeepL: "00000000-0000-4000-a000-000000000012",
  providerTextInsight: "00000000-0000-4000-a000-000000000013",
  providerVisionAI: "00000000-0000-4000-a000-000000000014",
  providerEmbedCo: "00000000-0000-4000-a000-000000000015",
  providerDataVault: "00000000-0000-4000-a000-000000000016",
  buyerAlice: "00000000-0000-4000-a000-000000000020",
  buyerBob: "00000000-0000-4000-a000-000000000021",
  buyerCarla: "00000000-0000-4000-a000-000000000022",

  // Categories
  catAI: "00000000-0000-4000-b000-000000000001",
  catNLP: "00000000-0000-4000-b000-000000000002",
  catVision: "00000000-0000-4000-b000-000000000003",
  catAudio: "00000000-0000-4000-b000-000000000004",
  catData: "00000000-0000-4000-b000-000000000005",
  catLangModels: "00000000-0000-4000-b000-000000000006",
  catTranslation: "00000000-0000-4000-b000-000000000007",
  catSentiment: "00000000-0000-4000-b000-000000000008",
  catEmbeddings: "00000000-0000-4000-b000-000000000009",
  catObjDetection: "00000000-0000-4000-b000-000000000010",

  // Listings
  lstGPT4: "00000000-0000-4000-c000-000000000001",
  lstClaude: "00000000-0000-4000-c000-000000000002",
  lstTranslate: "00000000-0000-4000-c000-000000000003",
  lstSentiment: "00000000-0000-4000-c000-000000000004",
  lstVision: "00000000-0000-4000-c000-000000000005",
  lstEmbeddings: "00000000-0000-4000-c000-000000000006",
  lstDataset: "00000000-0000-4000-c000-000000000007",

  // Provider Profiles
  ppOpenAI: "00000000-0000-4000-d000-000000000010",
  ppAnthropic: "00000000-0000-4000-d000-000000000011",
  ppDeepL: "00000000-0000-4000-d000-000000000012",
  ppTextInsight: "00000000-0000-4000-d000-000000000013",
  ppVisionAI: "00000000-0000-4000-d000-000000000014",
  ppEmbedCo: "00000000-0000-4000-d000-000000000015",
  ppDataVault: "00000000-0000-4000-d000-000000000016",
};

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function wallet(suffix: string): string {
  return `0x${suffix.padStart(40, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// MAIN SEED
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding NexusX database...\n");

  // ─── 1. Categories ───
  console.log("  📂 Categories...");
  const categories = [
    { id: ID.catAI, slug: "ai", name: "Artificial Intelligence", depth: 0, sortOrder: 1 },
    { id: ID.catNLP, slug: "nlp", name: "Natural Language Processing", parentId: ID.catAI, depth: 1, sortOrder: 1 },
    { id: ID.catVision, slug: "vision", name: "Computer Vision", parentId: ID.catAI, depth: 1, sortOrder: 2 },
    { id: ID.catAudio, slug: "audio", name: "Audio & Speech", parentId: ID.catAI, depth: 1, sortOrder: 3 },
    { id: ID.catData, slug: "datasets", name: "Datasets", depth: 0, sortOrder: 2 },
    { id: ID.catLangModels, slug: "language-models", name: "Language Models", parentId: ID.catNLP, depth: 2, sortOrder: 1 },
    { id: ID.catTranslation, slug: "translation", name: "Translation", parentId: ID.catNLP, depth: 2, sortOrder: 2 },
    { id: ID.catSentiment, slug: "sentiment-analysis", name: "Sentiment Analysis", parentId: ID.catNLP, depth: 2, sortOrder: 3 },
    { id: ID.catEmbeddings, slug: "embeddings", name: "Embeddings & Vectors", parentId: ID.catNLP, depth: 2, sortOrder: 4 },
    { id: ID.catObjDetection, slug: "object-detection", name: "Object Detection", parentId: ID.catVision, depth: 2, sortOrder: 1 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: {},
      create: cat,
    });
  }

  // ─── 2. Users ───
  console.log("  👤 Users...");
  const users = [
    { id: ID.admin, email: "admin@nexusx.io", displayName: "NexusX Admin", roles: ["ADMIN" as const] },
    { id: ID.providerOpenAI, email: "api@openai-proxy.com", displayName: "OpenAI Proxy", roles: ["PROVIDER" as const] },
    { id: ID.providerAnthropic, email: "api@anthropic-relay.com", displayName: "Anthropic Relay", roles: ["PROVIDER" as const] },
    { id: ID.providerDeepL, email: "api@deepl-connect.com", displayName: "DeepL Connect", roles: ["PROVIDER" as const] },
    { id: ID.providerTextInsight, email: "api@textinsight.ai", displayName: "TextInsight", roles: ["PROVIDER" as const] },
    { id: ID.providerVisionAI, email: "api@visionai.dev", displayName: "VisionAI", roles: ["PROVIDER" as const] },
    { id: ID.providerEmbedCo, email: "api@embedco.io", displayName: "EmbedCo", roles: ["PROVIDER" as const] },
    { id: ID.providerDataVault, email: "data@datavault.io", displayName: "DataVault", roles: ["PROVIDER" as const] },
    { id: ID.buyerAlice, email: "alice@startup.io", displayName: "Alice Chen", roles: ["BUYER" as const], kycStatus: "VERIFIED" as const },
    { id: ID.buyerBob, email: "bob@enterprise.co", displayName: "Bob Martinez", roles: ["BUYER" as const], kycStatus: "VERIFIED" as const },
    { id: ID.buyerCarla, email: "carla@research.edu", displayName: "Carla Rossi", roles: ["BUYER" as const] },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        ...user,
        kycStatus: (user as any).kycStatus || "NONE",
      },
    });
  }

  // ─── 3. Wallets ───
  console.log("  💰 Wallets...");
  const wallets = [
    { userId: ID.admin, address: wallet("AD01"), balanceUsdc: 0 },
    { userId: ID.providerOpenAI, address: wallet("P010"), balanceUsdc: 0 },
    { userId: ID.providerAnthropic, address: wallet("P011"), balanceUsdc: 0 },
    { userId: ID.providerDeepL, address: wallet("P012"), balanceUsdc: 0 },
    { userId: ID.providerTextInsight, address: wallet("P013"), balanceUsdc: 0 },
    { userId: ID.providerVisionAI, address: wallet("P014"), balanceUsdc: 0 },
    { userId: ID.providerEmbedCo, address: wallet("P015"), balanceUsdc: 0 },
    { userId: ID.providerDataVault, address: wallet("P016"), balanceUsdc: 0 },
    { userId: ID.buyerAlice, address: wallet("B020"), balanceUsdc: 500, escrowUsdc: 100 },
    { userId: ID.buyerBob, address: wallet("B021"), balanceUsdc: 2000, escrowUsdc: 500 },
    { userId: ID.buyerCarla, address: wallet("B022"), balanceUsdc: 50, escrowUsdc: 10 },
  ];

  for (const w of wallets) {
    await prisma.wallet.upsert({
      where: { userId: w.userId },
      update: {},
      create: { ...w, chainId: 8453 },
    });
  }

  // ─── 4. Provider Profiles ───
  console.log("  🏢 Provider profiles...");
  const providers = [
    { id: ID.ppOpenAI, userId: ID.providerOpenAI, companyName: "OpenAI Proxy Inc", website: "https://openai-proxy.com", payoutAddress: wallet("P010") },
    { id: ID.ppAnthropic, userId: ID.providerAnthropic, companyName: "Anthropic Relay LLC", website: "https://anthropic-relay.com", payoutAddress: wallet("P011") },
    { id: ID.ppDeepL, userId: ID.providerDeepL, companyName: "DeepL Connect GmbH", website: "https://deepl-connect.com", payoutAddress: wallet("P012") },
    { id: ID.ppTextInsight, userId: ID.providerTextInsight, companyName: "TextInsight AI", website: "https://textinsight.ai", payoutAddress: wallet("P013") },
    { id: ID.ppVisionAI, userId: ID.providerVisionAI, companyName: "VisionAI Labs", website: "https://visionai.dev", payoutAddress: wallet("P014") },
    { id: ID.ppEmbedCo, userId: ID.providerEmbedCo, companyName: "EmbedCo", website: "https://embedco.io", payoutAddress: wallet("P015") },
    { id: ID.ppDataVault, userId: ID.providerDataVault, companyName: "DataVault Inc", website: "https://datavault.io", payoutAddress: wallet("P016") },
  ];

  for (const pp of providers) {
    await prisma.providerProfile.upsert({
      where: { id: pp.id },
      update: {},
      create: { ...pp, description: `Official ${pp.companyName} marketplace provider.` },
    });
  }

  // ─── 5. Listings ───
  console.log("  📋 Listings...");
  const listings = [
    {
      id: ID.lstGPT4, providerId: ID.providerOpenAI, categoryId: ID.catLangModels,
      slug: "openai-gpt4-turbo", name: "OpenAI GPT-4 Turbo Inference",
      description: "High-quality language model with function calling, streaming, and JSON output support. Ideal for complex reasoning, code generation, and multi-step tasks.",
      listingType: "MODEL_INFERENCE" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v1", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.005, ceilingPriceUsdc: 0.05, currentPriceUsdc: 0.008,
      capacityPerMinute: 200, tags: ["gpt-4", "function-calling", "streaming", "json-output", "code-generation"],
      intents: [
        "generate text", "answer questions", "summarize content",
        "write code", "explain concepts", "chat with AI",
      ],
      totalCalls: BigInt(1_500_000), totalRevenue: 12000, avgRating: 4.8, ratingCount: 342,
      publishedAt: new Date("2025-01-15"),
    },
    {
      id: ID.lstClaude, providerId: ID.providerAnthropic, categoryId: ID.catLangModels,
      slug: "anthropic-claude-sonnet", name: "Anthropic Claude Sonnet Inference",
      description: "Advanced reasoning model with strong instruction following. Supports structured output, analysis, and creative writing.",
      listingType: "MODEL_INFERENCE" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v1", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.003, ceilingPriceUsdc: 0.03, currentPriceUsdc: 0.006,
      capacityPerMinute: 150, tags: ["claude", "reasoning", "analysis", "structured-output", "streaming"],
      intents: [
        "generate text", "reason about problems", "analyze documents",
        "write and review code", "creative writing",
      ],
      totalCalls: BigInt(800_000), totalRevenue: 4800, avgRating: 4.7, ratingCount: 198,
      publishedAt: new Date("2025-02-01"),
    },
    {
      id: ID.lstTranslate, providerId: ID.providerDeepL, categoryId: ID.catTranslation,
      slug: "deepl-translation-api", name: "DeepL Translation API",
      description: "High-accuracy neural machine translation supporting 30+ languages. REST API with batch processing support.",
      listingType: "REST_API" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v2", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.001, ceilingPriceUsdc: 0.01, currentPriceUsdc: 0.002,
      capacityPerMinute: 500, tags: ["translation", "multilingual", "batch-processing", "neural-mt"],
      intents: [
        "translate text between languages", "detect language",
        "localize content", "multilingual translation",
      ],
      totalCalls: BigInt(3_000_000), totalRevenue: 6000, avgRating: 4.6, ratingCount: 520,
      publishedAt: new Date("2024-11-01"),
    },
    {
      id: ID.lstSentiment, providerId: ID.providerTextInsight, categoryId: ID.catSentiment,
      slug: "sentiment-analysis-pro", name: "Sentiment Analysis Pro API",
      description: "Real-time sentiment analysis for text, reviews, and social media. Returns polarity, subjectivity, and entity-level sentiment.",
      listingType: "REST_API" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v1", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.0005, ceilingPriceUsdc: 0.005, currentPriceUsdc: 0.001,
      capacityPerMinute: 1000, tags: ["sentiment", "nlp", "social-media", "reviews", "classification"],
      intents: [
        "analyze sentiment", "detect emotion", "classify text tone",
        "measure opinion polarity",
      ],
      totalCalls: BigInt(5_000_000), totalRevenue: 5000, avgRating: 4.4, ratingCount: 410,
      publishedAt: new Date("2024-09-15"),
    },
    {
      id: ID.lstVision, providerId: ID.providerVisionAI, categoryId: ID.catObjDetection,
      slug: "vision-object-detection", name: "Vision Object Detection API",
      description: "Computer vision API for object detection, image classification, and scene understanding. Supports batch image processing.",
      listingType: "REST_API" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v1", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.001, ceilingPriceUsdc: 0.02, currentPriceUsdc: 0.003,
      capacityPerMinute: 300, tags: ["vision", "object-detection", "image-classification", "batch-processing"],
      intents: [
        "detect objects in images", "identify items in photos",
        "visual recognition", "image classification",
      ],
      totalCalls: BigInt(2_000_000), totalRevenue: 6000, avgRating: 4.5, ratingCount: 275,
      publishedAt: new Date("2024-12-01"),
    },
    {
      id: ID.lstEmbeddings, providerId: ID.providerEmbedCo, categoryId: ID.catEmbeddings,
      slug: "text-embeddings-v3", name: "Text Embeddings v3",
      description: "High-dimensional text embeddings for semantic search, clustering, and similarity. 1536-dimension vectors.",
      listingType: "REST_API" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v3", healthCheckUrl: "http://localhost:3500/health",
      floorPriceUsdc: 0.0002, ceilingPriceUsdc: 0.002, currentPriceUsdc: 0.0005,
      capacityPerMinute: 2000, tags: ["embeddings", "semantic-search", "vectors", "clustering"],
      intents: [
        "generate text embeddings", "create vector representations",
        "compute text similarity", "encode text for search",
      ],
      totalCalls: BigInt(10_000_000), totalRevenue: 5000, avgRating: 4.6, ratingCount: 680,
      publishedAt: new Date("2024-08-01"),
    },
    {
      id: ID.lstDataset, providerId: ID.providerDataVault, categoryId: ID.catData,
      slug: "restaurant-reviews-dataset", name: "Restaurant Reviews Dataset (500K)",
      description: "Curated dataset of 500,000 restaurant reviews with sentiment labels, ratings, and location data. CSV and Parquet formats.",
      listingType: "DATASET" as const, status: "ACTIVE" as const,
      baseUrl: "http://localhost:3500/v1/download",
      floorPriceUsdc: 0.02, ceilingPriceUsdc: 0.20, currentPriceUsdc: 0.05,
      capacityPerMinute: 10, tags: ["dataset", "reviews", "restaurant", "sentiment", "labeled-data"],
      intents: [
        "download restaurant reviews", "access review dataset",
        "get sample review data",
      ],
      totalCalls: BigInt(5_000), totalRevenue: 250, avgRating: 4.3, ratingCount: 45,
      publishedAt: new Date("2025-01-01"),
    },
  ];

  for (const listing of listings) {
    await prisma.listing.upsert({
      where: { id: listing.id },
      update: {},
      create: listing,
    });
  }

  // ─── 6. API Keys ───
  console.log("  🔑 API keys...");
  const apiKeys = [
    { userId: ID.buyerAlice, name: "Alice Production", rawKey: "nxs_aliceprd_abcdefghijklmnopqrstuvwxyz01", rateLimitRpm: 120 },
    { userId: ID.buyerAlice, name: "Alice Development", rawKey: "nxs_alicedev_abcdefghijklmnopqrstuvwxyz02", rateLimitRpm: 30 },
    { userId: ID.buyerBob, name: "Bob Production", rawKey: "nxs_bobprod0_abcdefghijklmnopqrstuvwxyz03", rateLimitRpm: 200 },
    { userId: ID.buyerCarla, name: "Carla Research", rawKey: "nxs_carlares_abcdefghijklmnopqrstuvwxyz04", rateLimitRpm: 60 },
  ];

  for (const key of apiKeys) {
    const keyHash = hashKey(key.rawKey);
    const keyPrefix = key.rawKey.slice(4, 12);
    await prisma.apiKey.upsert({
      where: { keyHash },
      update: {},
      create: {
        userId: key.userId,
        name: key.name,
        keyHash,
        keyPrefix,
        rateLimitRpm: key.rateLimitRpm,
        status: "ACTIVE",
      },
    });
  }

  // ─── 7. Subscriptions ───
  console.log("  📄 Subscriptions...");
  await prisma.subscription.upsert({
    where: { buyerId_listingId: { buyerId: ID.buyerAlice, listingId: ID.lstGPT4 } },
    update: {},
    create: {
      buyerId: ID.buyerAlice, listingId: ID.lstGPT4,
      status: "ACTIVE", monthlyBudgetUsdc: 100,
      spentThisMonthUsdc: 32.50, totalSpentUsdc: 245.80, totalCalls: BigInt(30000),
    },
  });
  await prisma.subscription.upsert({
    where: { buyerId_listingId: { buyerId: ID.buyerBob, listingId: ID.lstTranslate } },
    update: {},
    create: {
      buyerId: ID.buyerBob, listingId: ID.lstTranslate,
      status: "ACTIVE", monthlyBudgetUsdc: 500,
      spentThisMonthUsdc: 120, totalSpentUsdc: 890, totalCalls: BigInt(445000),
    },
  });
  await prisma.subscription.upsert({
    where: { buyerId_listingId: { buyerId: ID.buyerBob, listingId: ID.lstSentiment } },
    update: {},
    create: {
      buyerId: ID.buyerBob, listingId: ID.lstSentiment,
      status: "ACTIVE", monthlyBudgetUsdc: 200,
      spentThisMonthUsdc: 45, totalSpentUsdc: 310, totalCalls: BigInt(310000),
    },
  });

  // ─── 8. Watchlist Items ───
  console.log("  👀 Watchlist items...");
  const watchlistItems = [
    { buyerId: ID.buyerAlice, listingId: ID.lstClaude, alertOnPriceDrop: true, alertThreshold: 0.004 },
    { buyerId: ID.buyerAlice, listingId: ID.lstEmbeddings, alertOnPriceDrop: false },
    { buyerId: ID.buyerCarla, listingId: ID.lstGPT4, alertOnPriceDrop: true, alertThreshold: 0.006 },
    { buyerId: ID.buyerCarla, listingId: ID.lstDataset, alertOnPriceDrop: false },
  ];

  for (const item of watchlistItems) {
    await prisma.watchlistItem.upsert({
      where: { buyerId_listingId: { buyerId: item.buyerId, listingId: item.listingId } },
      update: {},
      create: item,
    });
  }

  // ─── 9. Ratings ───
  console.log("  ⭐ Ratings...");
  const ratings = [
    { listingId: ID.lstGPT4, buyerId: ID.buyerAlice, score: 5, title: "Excellent", body: "Incredibly fast and accurate for code generation." },
    { listingId: ID.lstGPT4, buyerId: ID.buyerBob, score: 4, title: "Great but pricey", body: "Quality is top-notch. Price fluctuations can be surprising." },
    { listingId: ID.lstTranslate, buyerId: ID.buyerBob, score: 5, title: "Best translation API", body: "Handles all our 12 languages perfectly with sub-200ms latency." },
    { listingId: ID.lstSentiment, buyerId: ID.buyerBob, score: 4, title: "Good accuracy", body: "Entity-level sentiment is very useful for our product reviews pipeline." },
    { listingId: ID.lstClaude, buyerId: ID.buyerCarla, score: 5, title: "Perfect for research", body: "Structured output and analysis capabilities are unmatched." },
    { listingId: ID.lstEmbeddings, buyerId: ID.buyerAlice, score: 5, title: "Fast and cheap", body: "Perfect for our semantic search pipeline. Sub-50ms." },
  ];

  for (const rating of ratings) {
    await prisma.rating.upsert({
      where: { listingId_buyerId: { listingId: rating.listingId, buyerId: rating.buyerId } },
      update: {},
      create: { ...rating, isPublic: true },
    });
  }

  // ─── 10. Quality Snapshots ───
  console.log("  📊 Quality snapshots...");
  const qualitySnapshots = [
    { listingId: ID.lstGPT4, uptimePercent: 99.9, medianLatencyMs: 450, p99LatencyMs: 1200, errorRatePercent: 0.1, averageRating: 4.8, ratingCount: 342, compositeScore: 95 },
    { listingId: ID.lstClaude, uptimePercent: 99.8, medianLatencyMs: 380, p99LatencyMs: 950, errorRatePercent: 0.15, averageRating: 4.7, ratingCount: 198, compositeScore: 93 },
    { listingId: ID.lstTranslate, uptimePercent: 99.95, medianLatencyMs: 120, p99LatencyMs: 300, errorRatePercent: 0.05, averageRating: 4.6, ratingCount: 520, compositeScore: 92 },
    { listingId: ID.lstSentiment, uptimePercent: 99.7, medianLatencyMs: 50, p99LatencyMs: 150, errorRatePercent: 0.3, averageRating: 4.4, ratingCount: 410, compositeScore: 88 },
    { listingId: ID.lstVision, uptimePercent: 99.6, medianLatencyMs: 200, p99LatencyMs: 600, errorRatePercent: 0.4, averageRating: 4.5, ratingCount: 275, compositeScore: 90 },
    { listingId: ID.lstEmbeddings, uptimePercent: 99.99, medianLatencyMs: 30, p99LatencyMs: 80, errorRatePercent: 0.01, averageRating: 4.6, ratingCount: 680, compositeScore: 91 },
    { listingId: ID.lstDataset, uptimePercent: 99.0, medianLatencyMs: 2000, p99LatencyMs: 5000, errorRatePercent: 1.0, averageRating: 4.3, ratingCount: 45, compositeScore: 85 },
  ];

  for (const qs of qualitySnapshots) {
    await prisma.qualitySnapshot.create({
      data: { ...qs, computedAt: new Date() },
    });
  }

  // ─── 11. Platform Config ───
  console.log("  ⚙️  Platform config...");
  const configs = [
    { key: "platform.fee_rate", value: { rate: 0.12, description: "12% platform fee" } },
    { key: "platform.settlement.batch_size", value: { maxBatchSize: 100, minBatchValueUsdc: 1 } },
    { key: "platform.settlement.gas_ceiling", value: { maxGasPriceGwei: 5 } },
    { key: "platform.pricing.config_version", value: { version: "LAUNCH_CONFIG", updatedAt: new Date().toISOString() } },
    { key: "platform.features.sandbox_enabled", value: { enabled: true } },
    { key: "platform.features.llm_classifier", value: { enabled: true, model: "claude-sonnet-4-5-20250929" } },
  ];

  for (const config of configs) {
    await prisma.platformConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  // ─── Summary ───
  const counts = {
    categories: await prisma.category.count(),
    users: await prisma.user.count(),
    wallets: await prisma.wallet.count(),
    providerProfiles: await prisma.providerProfile.count(),
    listings: await prisma.listing.count(),
    apiKeys: await prisma.apiKey.count(),
    subscriptions: await prisma.subscription.count(),
    watchlistItems: await prisma.watchlistItem.count(),
    ratings: await prisma.rating.count(),
    qualitySnapshots: await prisma.qualitySnapshot.count(),
    platformConfig: await prisma.platformConfig.count(),
  };

  console.log("\n✅ Seed complete!");
  console.log("   Records created:", JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
