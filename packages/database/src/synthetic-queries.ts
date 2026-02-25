// ═══════════════════════════════════════════════════════════════
// NexusX — Synthetic Query Generator
// packages/database/src/synthetic-queries.ts
//
// Generates diverse synthetic search queries for each listing
// using an LLM. These queries expand the semantic footprint of
// listing embeddings so intent-based agent searches match even
// when the listing description uses different vocabulary.
//
// Each listing gets 10 queries across 5 archetypes:
//   - Direct:      "translation API"
//   - Intent:      "I need to translate legal documents to French"
//   - Use-case:    "multilingual customer support tool"
//   - Comparative: "cheap alternative to Google Translate"
//   - Technical:   "neural machine translation REST endpoint"
//
// Async, idempotent, and version-tracked. Failed generations
// don't block embedding — the listing embeds with just its
// description and tags.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";

// Bump this when the prompt changes to trigger re-generation.
export const CURRENT_SYNTHETIC_VERSION = 1;

const GENERATION_PROMPT = `You are a search query generator for NexusX, an AI data and API marketplace.

Given a listing's name, description, category, and tags, generate exactly 10 diverse search queries that a developer or AI agent might use to find this listing. Cover these archetypes:

1-2: Direct queries (e.g., "translation API")
3-4: Intent-based queries (e.g., "I need to translate legal documents to French")
5-6: Use-case queries (e.g., "multilingual customer support tool")
7-8: Comparative queries (e.g., "cheap alternative to Google Translate")
9-10: Technical queries (e.g., "neural machine translation REST endpoint")

Rules:
- Each query should be 3-15 words
- Use natural, varied language — avoid repeating the listing name verbatim
- Include domain-specific jargon where appropriate
- Think about what problem the user is trying to solve

Respond ONLY with a JSON array of 10 strings. No markdown, no explanation.`;

interface ListingForSynthetic {
  id: string;
  name: string;
  description: string;
  tags: string[];
  syntheticQueriesVersion: number;
  category: { slug: string; name: string };
}

/**
 * Generate synthetic queries for a single listing.
 * Idempotent: skips if the listing already has queries at the current version.
 *
 * Tries Anthropic (Claude Haiku) first, falls back to OpenAI (gpt-4o-mini).
 */
export async function generateSyntheticQueries(
  prisma: PrismaClient,
  listingId: string,
  options?: { force?: boolean },
): Promise<string[]> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      name: true,
      description: true,
      tags: true,
      syntheticQueriesVersion: true,
      category: { select: { slug: true, name: true } },
    },
  }) as ListingForSynthetic | null;

  if (!listing) return [];

  // Skip if already at current version (unless forced)
  if (!options?.force && listing.syntheticQueriesVersion >= CURRENT_SYNTHETIC_VERSION) {
    return [];
  }

  const userMessage = [
    `Listing: ${listing.name}`,
    `Category: ${listing.category.name} (${listing.category.slug})`,
    `Description: ${listing.description.slice(0, 500)}`,
    `Tags: ${listing.tags.join(", ") || "none"}`,
  ].join("\n");

  let queries: string[] = [];

  // Try Anthropic first (uses existing ANTHROPIC_API_KEY)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      queries = await callAnthropic(anthropicKey, userMessage);
    } catch (err) {
      console.error(`[SyntheticQueries] Anthropic failed for ${listingId}:`, err);
    }
  }

  // Fall back to OpenAI
  if (queries.length === 0) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        queries = await callOpenAI(openaiKey, userMessage);
      } catch (err) {
        console.error(`[SyntheticQueries] OpenAI failed for ${listingId}:`, err);
      }
    }
  }

  if (queries.length === 0) {
    console.warn(`[SyntheticQueries] No queries generated for ${listingId} — no API key available or all calls failed`);
    return [];
  }

  // Store in DB
  await prisma.listing.update({
    where: { id: listingId },
    data: {
      syntheticQueries: queries,
      syntheticQueriesVersion: CURRENT_SYNTHETIC_VERSION,
    },
  });

  return queries;
}

/**
 * Generate synthetic queries for all listings that need them.
 * Processes sequentially to avoid rate limits.
 */
export async function generateAllSyntheticQueries(
  prisma: PrismaClient,
  options?: { force?: boolean },
): Promise<{ generated: number; skipped: number; errors: number }> {
  const force = options?.force ?? false;

  const listings = await prisma.listing.findMany({
    where: {
      status: "ACTIVE",
      ...(force ? {} : { syntheticQueriesVersion: { lt: CURRENT_SYNTHETIC_VERSION } }),
    },
    select: { id: true },
  });

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const listing of listings) {
    try {
      const queries = await generateSyntheticQueries(prisma, listing.id, { force });
      if (queries.length > 0) generated++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(`[SyntheticQueries] Error for ${listing.id}:`, err);
    }

    // Small delay between listings to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { generated, skipped, errors };
}

// ─── LLM Callers ─────────────────────────────────────────────

async function callAnthropic(apiKey: string, userMessage: string): Promise<string[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: GENERATION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data: unknown = await response.json();
  const text = extractAnthropicText(data);
  return parseQueryArray(text);
}

async function callOpenAI(apiKey: string, userMessage: string): Promise<string[]> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 512,
      messages: [
        { role: "system", content: GENERATION_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data: unknown = await response.json();
  const text = extractOpenAiText(data);
  return parseQueryArray(text);
}

function parseQueryArray(text: string): string[] {
  const clean = text.replace(/```json\s*|```\s*/g, "").trim();
  const parsed = JSON.parse(clean);

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((q: unknown): q is string => typeof q === "string" && q.length > 0)
    .slice(0, 10);
}

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function extractAnthropicText(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as AnthropicResponse).content)
  ) {
    return (raw as AnthropicResponse).content?.[0]?.text ?? "[]";
  }
  return "[]";
}

function extractOpenAiText(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as OpenAiChatResponse).choices)
  ) {
    return (raw as OpenAiChatResponse).choices?.[0]?.message?.content ?? "[]";
  }
  return "[]";
}
