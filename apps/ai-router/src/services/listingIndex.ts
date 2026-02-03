// ═══════════════════════════════════════════════════════════════
// NexusX — Listing Index
// apps/ai-router/src/services/listingIndex.ts
//
// In-memory inverted index of active marketplace listings.
// Supports text relevance scoring (TF-IDF), category matching,
// tag matching, and fast filtering by type/price/capacity.
//
// Refreshed periodically from the database. In production,
// back with Redis or Elasticsearch for scale.
// ═══════════════════════════════════════════════════════════════

import type { IndexedListing } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Function to load all active listings from the database. */
export type ListingLoaderFn = () => Promise<IndexedListing[]>;

interface TermEntry {
  listingId: string;
  frequency: number;
}

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class ListingIndex {
  /** All indexed listings by ID. */
  private listings: Map<string, IndexedListing> = new Map();
  /** Inverted index: term → list of (listingId, frequency). */
  private invertedIndex: Map<string, TermEntry[]> = new Map();
  /** Category index: categorySlug → listing IDs. */
  private categoryIndex: Map<string, Set<string>> = new Map();
  /** Tag index: tag → listing IDs. */
  private tagIndex: Map<string, Set<string>> = new Map();
  /** Type index: listingType → listing IDs. */
  private typeIndex: Map<string, Set<string>> = new Map();
  /** Total documents (for IDF). */
  private totalDocs: number = 0;

  private loader: ListingLoaderFn;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastRefresh: number = 0;

  constructor(loader: ListingLoaderFn, refreshIntervalMs: number = 60_000) {
    this.loader = loader;
    this.refreshTimer = setInterval(() => this.refresh(), refreshIntervalMs);
  }

  /**
   * Load/reload all listings from the database and rebuild indexes.
   */
  async refresh(): Promise<void> {
    const startTime = performance.now();

    try {
      const listings = await this.loader();
      this.rebuild(listings);
      this.lastRefresh = Date.now();

      const elapsed = Math.round(performance.now() - startTime);
      console.log(
        `[ListingIndex] Refreshed: ${listings.length} listings indexed in ${elapsed}ms.`
      );
    } catch (err) {
      console.error("[ListingIndex] Refresh failed:", err);
    }
  }

  /**
   * Rebuild all indexes from a list of listings.
   */
  rebuild(listings: IndexedListing[]): void {
    this.listings.clear();
    this.invertedIndex.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
    this.typeIndex.clear();

    for (const listing of listings) {
      if (listing.status !== "ACTIVE") continue;

      this.listings.set(listing.id, listing);

      // Build inverted index from name + description + tags.
      const tokens = this.tokenize(
        `${listing.name} ${listing.description} ${listing.tags.join(" ")} ${listing.providerName}`
      );
      const termFreqs = this.computeTermFrequencies(tokens);
      for (const [term, freq] of termFreqs) {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, []);
        }
        this.invertedIndex.get(term)!.push({ listingId: listing.id, frequency: freq });
      }

      // Category index.
      for (const cat of [listing.categorySlug, ...listing.categoryPath]) {
        if (!this.categoryIndex.has(cat)) {
          this.categoryIndex.set(cat, new Set());
        }
        this.categoryIndex.get(cat)!.add(listing.id);
      }

      // Tag index.
      for (const tag of listing.tags) {
        const normalTag = tag.toLowerCase();
        if (!this.tagIndex.has(normalTag)) {
          this.tagIndex.set(normalTag, new Set());
        }
        this.tagIndex.get(normalTag)!.add(listing.id);
      }

      // Type index.
      if (!this.typeIndex.has(listing.listingType)) {
        this.typeIndex.set(listing.listingType, new Set());
      }
      this.typeIndex.get(listing.listingType)!.add(listing.id);
    }

    this.totalDocs = this.listings.size;
  }

  // ─── Query Methods ───

  /**
   * Compute TF-IDF text relevance score for a query against all listings.
   * Returns a Map of listingId → relevance score [0, 1].
   */
  textSearch(query: string): Map<string, number> {
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, number>();

    if (queryTokens.length === 0 || this.totalDocs === 0) return scores;

    for (const token of queryTokens) {
      const entries = this.invertedIndex.get(token);
      if (!entries) continue;

      // IDF = log(totalDocs / docsContainingTerm).
      const idf = Math.log(this.totalDocs / entries.length);

      for (const entry of entries) {
        // TF-IDF score for this term in this document.
        const tfidf = entry.frequency * idf;
        scores.set(entry.listingId, (scores.get(entry.listingId) || 0) + tfidf);
      }
    }

    // Normalize to [0, 1].
    const maxScore = Math.max(...scores.values(), 0.001);
    for (const [id, score] of scores) {
      scores.set(id, score / maxScore);
    }

    return scores;
  }

  /**
   * Find listings matching category slugs.
   * Returns listing IDs with match count.
   */
  categorySearch(categorySlugs: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    if (categorySlugs.length === 0) return scores;

    for (const slug of categorySlugs) {
      const ids = this.categoryIndex.get(slug);
      if (!ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    // Normalize by number of requested categories.
    for (const [id, count] of scores) {
      scores.set(id, count / categorySlugs.length);
    }

    return scores;
  }

  /**
   * Find listings matching tags.
   */
  tagSearch(tags: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    if (tags.length === 0) return scores;

    for (const tag of tags) {
      const ids = this.tagIndex.get(tag.toLowerCase());
      if (!ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    for (const [id, count] of scores) {
      scores.set(id, count / tags.length);
    }

    return scores;
  }

  /**
   * Get all listings of a specific type.
   */
  getByType(listingType: string): IndexedListing[] {
    const ids = this.typeIndex.get(listingType);
    if (!ids) return [];
    return [...ids].map((id) => this.listings.get(id)!).filter(Boolean);
  }

  /**
   * Get a listing by ID.
   */
  get(id: string): IndexedListing | undefined {
    return this.listings.get(id);
  }

  /**
   * Get all indexed listings.
   */
  getAll(): IndexedListing[] {
    return [...this.listings.values()];
  }

  /**
   * Index stats for monitoring.
   */
  stats(): {
    totalListings: number;
    totalTerms: number;
    totalCategories: number;
    totalTags: number;
    lastRefresh: number;
  } {
    return {
      totalListings: this.listings.size,
      totalTerms: this.invertedIndex.size,
      totalCategories: this.categoryIndex.size,
      totalTags: this.tagIndex.size,
      lastRefresh: this.lastRefresh,
    };
  }

  // ─── Internal ───

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .filter((t) => !STOP_WORDS.has(t));
  }

  private computeTermFrequencies(tokens: string[]): Map<string, number> {
    const freqs = new Map<string, number>();
    for (const token of tokens) {
      freqs.set(token, (freqs.get(token) || 0) + 1);
    }
    // Normalize by document length.
    const maxFreq = Math.max(...freqs.values(), 1);
    for (const [term, freq] of freqs) {
      freqs.set(term, freq / maxFreq);
    }
    return freqs;
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.listings.clear();
    this.invertedIndex.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
    this.typeIndex.clear();
  }
}

// ─── Stop words to ignore in text indexing ───
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "it", "as", "be", "was", "are", "that",
  "this", "from", "has", "have", "had", "not", "can", "will", "do",
  "does", "did", "its", "my", "your", "we", "our", "i", "me", "you",
  "he", "she", "they", "them", "which", "what", "when", "where", "how",
  "all", "each", "any", "no", "so", "if", "up", "out", "about", "into",
  "than", "then", "also", "just", "more", "some", "very", "need",
]);
