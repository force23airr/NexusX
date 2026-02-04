// ═══════════════════════════════════════════════════════════════
// NexusX — Create New Listing Page
// apps/web/src/app/provider/listings/new/page.tsx
//
// Multi-section form for providers to post APIs to the marketplace.
// Creates listing as DRAFT status on submit.
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { provider, marketplace } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ListingType } from "@/types";

// ─── Types ───

interface Category {
  id: string;
  slug: string;
  name: string;
  depth: number;
}

interface FormData {
  name: string;
  slug: string;
  listingType: ListingType;
  categoryId: string;
  sectors: string[];
  description: string;
  videoUrl: string;
  baseUrl: string;
  healthCheckUrl: string;
  docsUrl: string;
  sandboxUrl: string;
  authType: string;
  floorPrice: string;
  ceilingPrice: string;
  capacityPerMinute: string;
  tags: string[];
  isUnique: boolean;
  sampleRequest: string;
  sampleResponse: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  slug: "",
  listingType: "REST_API",
  categoryId: "",
  sectors: [],
  description: "",
  videoUrl: "",
  baseUrl: "",
  healthCheckUrl: "",
  docsUrl: "",
  sandboxUrl: "",
  authType: "api_key",
  floorPrice: "",
  ceilingPrice: "",
  capacityPerMinute: "60",
  tags: [],
  isUnique: false,
  sampleRequest: "",
  sampleResponse: "",
};

const SECTORS = [
  { value: "consumer-products", label: "Consumer Products" },
  { value: "hardware", label: "Hardware" },
  { value: "military-defense", label: "Military & Defense" },
  { value: "logistics", label: "Logistics" },
  { value: "shopping-commerce", label: "Shopping & Commerce" },
  { value: "healthcare", label: "Healthcare" },
  { value: "fintech", label: "Fintech & Banking" },
  { value: "education", label: "Education" },
  { value: "real-estate", label: "Real Estate" },
  { value: "automotive", label: "Automotive" },
  { value: "energy", label: "Energy & Utilities" },
  { value: "media-entertainment", label: "Media & Entertainment" },
  { value: "agriculture", label: "Agriculture" },
  { value: "telecommunications", label: "Telecommunications" },
  { value: "travel-hospitality", label: "Travel & Hospitality" },
  { value: "general-purpose", label: "General Purpose / Cross-Industry" },
];

const LISTING_TYPES: { value: ListingType; label: string }[] = [
  { value: "REST_API", label: "REST API" },
  { value: "GRAPHQL_API", label: "GraphQL API" },
  { value: "WEBSOCKET", label: "WebSocket" },
  { value: "DATASET", label: "Dataset" },
  { value: "MODEL_INFERENCE", label: "Model Inference" },
  { value: "COMPOSITE", label: "Composite" },
];

const AUTH_TYPES = [
  { value: "api_key", label: "API Key" },
  { value: "oauth2", label: "OAuth 2.0" },
  { value: "jwt", label: "JWT" },
  { value: "none", label: "None" },
];

// ─── Video Embed Helpers ───

function extractVideoEmbedUrl(url: string): string | null {
  if (!url) return null;

  // YouTube: youtube.com/watch?v=ID or youtu.be/ID
  const ytMatch =
    url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) ??
    url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

  // Vimeo: vimeo.com/ID
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  return null;
}

// ─── Slug Generation ───

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Component ───

export default function CreateListingPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load categories
  useEffect(() => {
    marketplace.getCategories().then(setCategories).catch(console.error);
  }, []);

  // Auto-generate slug from name
  useEffect(() => {
    if (!slugEdited) {
      setForm((prev) => ({ ...prev, slug: slugify(prev.name) }));
    }
  }, [form.name, slugEdited]);

  const updateField = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  // Tag management
  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (trimmed && !form.tags.includes(trimmed)) {
        updateField("tags", [...form.tags, trimmed]);
      }
      setTagInput("");
    },
    [form.tags, updateField]
  );

  const removeTag = useCallback(
    (tag: string) => {
      updateField(
        "tags",
        form.tags.filter((t) => t !== tag)
      );
    },
    [form.tags, updateField]
  );

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addTag(tagInput);
      } else if (e.key === "Backspace" && !tagInput && form.tags.length > 0) {
        removeTag(form.tags[form.tags.length - 1]);
      }
    },
    [tagInput, form.tags, addTag, removeTag]
  );

  // Validation
  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.slug.trim()) errs.slug = "Slug is required";
    if (!form.description.trim()) errs.description = "Description is required";
    if (!form.categoryId) errs.categoryId = "Category is required";
    if (form.sectors.length === 0) errs.sectors = "Select at least one sector";
    if (!form.baseUrl.trim()) errs.baseUrl = "Base URL is required";
    if (!form.floorPrice || parseFloat(form.floorPrice) <= 0)
      errs.floorPrice = "Floor price must be greater than 0";
    if (
      form.ceilingPrice &&
      parseFloat(form.ceilingPrice) <= parseFloat(form.floorPrice)
    )
      errs.ceilingPrice = "Ceiling must be greater than floor";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  // Submit
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        let sampleRequest = null;
        let sampleResponse = null;
        if (form.sampleRequest.trim()) {
          try {
            sampleRequest = JSON.parse(form.sampleRequest);
          } catch {
            setErrors((prev) => ({
              ...prev,
              sampleRequest: "Invalid JSON",
            }));
            setIsSubmitting(false);
            return;
          }
        }
        if (form.sampleResponse.trim()) {
          try {
            sampleResponse = JSON.parse(form.sampleResponse);
          } catch {
            setErrors((prev) => ({
              ...prev,
              sampleResponse: "Invalid JSON",
            }));
            setIsSubmitting(false);
            return;
          }
        }

        await provider.createListing({
          name: form.name,
          slug: form.slug,
          listingType: form.listingType,
          categoryId: form.categoryId,
          sectors: form.sectors,
          description: form.description,
          videoUrl: form.videoUrl || undefined,
          baseUrl: form.baseUrl,
          healthCheckUrl: form.healthCheckUrl || undefined,
          docsUrl: form.docsUrl || undefined,
          sandboxUrl: form.sandboxUrl || undefined,
          authType: form.authType,
          floorPriceUsdc: parseFloat(form.floorPrice),
          ceilingPriceUsdc: form.ceilingPrice
            ? parseFloat(form.ceilingPrice)
            : undefined,
          capacityPerMinute: parseInt(form.capacityPerMinute, 10) || 60,
          tags: form.tags,
          isUnique: form.isUnique,
          sampleRequest,
          sampleResponse,
        });

        router.push("/provider/listings?created=1");
      } catch (err: any) {
        setSubmitError(err.message || "Failed to create listing");
      } finally {
        setIsSubmitting(false);
      }
    },
    [form, validate, router]
  );

  const videoEmbedUrl = extractVideoEmbedUrl(form.videoUrl);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/provider/listings")}
          className="btn-ghost text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back to Listings
        </button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Create New Listing
          </h1>
          <p className="mt-1 text-zinc-400">
            Post your API to the marketplace as a draft.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* ─── Basics ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Basics" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <FieldLabel label="Listing Name" error={errors.name} />
              <input
                className={cn("input-base w-full", errors.name && "border-red-500/50")}
                placeholder="My Weather API"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Type" />
              <select
                className="input-base w-full"
                value={form.listingType}
                onChange={(e) =>
                  updateField("listingType", e.target.value as ListingType)
                }
              >
                {LISTING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="Category" error={errors.categoryId} />
              <select
                className={cn("input-base w-full", errors.categoryId && "border-red-500/50")}
                value={form.categoryId}
                onChange={(e) => updateField("categoryId", e.target.value)}
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"\u00A0".repeat(c.depth * 2)}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel label="Sector / Industry" error={errors.sectors} />
            <div className={cn(
              "flex flex-wrap gap-2",
              errors.sectors && "ring-1 ring-red-500/50 rounded-lg p-2"
            )}>
              {SECTORS.map((s) => {
                const selected = form.sectors.includes(s.value);
                const atLimit = form.sectors.length >= 3 && !selected;
                return (
                  <button
                    key={s.value}
                    type="button"
                    disabled={atLimit}
                    onClick={() => {
                      if (selected) {
                        updateField("sectors", form.sectors.filter((v) => v !== s.value));
                      } else {
                        updateField("sectors", [...form.sectors, s.value]);
                      }
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border",
                      selected
                        ? "bg-brand-600/20 text-brand-300 border-brand-600/30"
                        : atLimit
                          ? "bg-surface-3/50 text-zinc-600 border-transparent cursor-not-allowed"
                          : "bg-surface-3 text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-surface-4"
                    )}
                  >
                    {selected && <span className="mr-1">&#10003;</span>}
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-zinc-500 mt-1.5">
              Select up to 3 industries that will use this API. Helps buyers find you.
            </p>
          </div>

          <div>
            <FieldLabel label="Slug" error={errors.slug} />
            <input
              className={cn("input-base w-full font-mono text-xs", errors.slug && "border-red-500/50")}
              placeholder="my-weather-api"
              value={form.slug}
              onChange={(e) => {
                setSlugEdited(true);
                updateField("slug", slugify(e.target.value));
              }}
            />
            {!slugEdited && form.slug && (
              <p className="text-2xs text-zinc-500 mt-1">
                Auto-generated from name
              </p>
            )}
          </div>
        </section>

        {/* ─── Description ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Describe Your API" />
          <div>
            <FieldLabel
              label="Description"
              error={errors.description}
            />
            <textarea
              className={cn("input-base w-full min-h-[200px] resize-y", errors.description && "border-red-500/50")}
              placeholder="Tell potential customers what your API does, who it's for, and what they can build with it..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </div>
        </section>

        {/* ─── Video ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Explainer Video" />
          <div>
            <FieldLabel label="YouTube or Vimeo URL" />
            <input
              className="input-base w-full"
              placeholder="https://youtube.com/watch?v=..."
              value={form.videoUrl}
              onChange={(e) => updateField("videoUrl", e.target.value)}
            />
          </div>
          {videoEmbedUrl && (
            <div className="rounded-lg overflow-hidden border border-surface-4 aspect-video">
              <iframe
                src={videoEmbedUrl}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Video preview"
              />
            </div>
          )}
          {form.videoUrl && !videoEmbedUrl && (
            <p className="text-2xs text-amber-400">
              Could not parse video URL. Supported: youtube.com/watch?v=...,
              youtu.be/..., vimeo.com/...
            </p>
          )}
        </section>

        {/* ─── Technical ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Technical Details" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel label="Base URL" error={errors.baseUrl} />
              <input
                className={cn("input-base w-full", errors.baseUrl && "border-red-500/50")}
                placeholder="https://api.example.com/v1"
                value={form.baseUrl}
                onChange={(e) => updateField("baseUrl", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Health Check URL" />
              <input
                className="input-base w-full"
                placeholder="https://api.example.com/health"
                value={form.healthCheckUrl}
                onChange={(e) => updateField("healthCheckUrl", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Docs URL" />
              <input
                className="input-base w-full"
                placeholder="https://docs.example.com"
                value={form.docsUrl}
                onChange={(e) => updateField("docsUrl", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Sandbox URL" />
              <input
                className="input-base w-full"
                placeholder="https://sandbox.example.com"
                value={form.sandboxUrl}
                onChange={(e) => updateField("sandboxUrl", e.target.value)}
              />
            </div>
          </div>
          <div className="max-w-xs">
            <FieldLabel label="Auth Type" />
            <select
              className="input-base w-full"
              value={form.authType}
              onChange={(e) => updateField("authType", e.target.value)}
            >
              {AUTH_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* ─── Pricing ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Pricing (USDC per call)" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel
                label="Floor Price"
                error={errors.floorPrice}
                info="The minimum price per API call. The auction engine will never price your API below this amount."
              />
              <input
                type="number"
                step="0.000001"
                min="0"
                className={cn("input-base w-full font-mono", errors.floorPrice && "border-red-500/50")}
                placeholder="0.001"
                value={form.floorPrice}
                onChange={(e) => updateField("floorPrice", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel
                label="Ceiling Price"
                error={errors.ceilingPrice}
                info="The maximum price per API call. During high demand, the auction engine can raise the price up to this cap."
              />
              <input
                type="number"
                step="0.000001"
                min="0"
                className={cn("input-base w-full font-mono", errors.ceilingPrice && "border-red-500/50")}
                placeholder="0.01"
                value={form.ceilingPrice}
                onChange={(e) => updateField("ceilingPrice", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Capacity / min" />
              <input
                type="number"
                min="1"
                className="input-base w-full font-mono"
                placeholder="60"
                value={form.capacityPerMinute}
                onChange={(e) =>
                  updateField("capacityPerMinute", e.target.value)
                }
              />
            </div>
          </div>
        </section>

        {/* ─── Discovery ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Discovery" />

          <div>
            <FieldLabel label="Tags" />
            <div className="input-base w-full flex flex-wrap items-center gap-2 min-h-[42px]">
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-brand-600/20 text-brand-300 px-2 py-0.5 rounded-md text-xs font-medium"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-brand-400 hover:text-white ml-0.5"
                  >
                    &times;
                  </button>
                </span>
              ))}
              <input
                className="bg-transparent outline-none text-sm text-zinc-100 placeholder-zinc-500 flex-1 min-w-[120px]"
                placeholder={
                  form.tags.length === 0
                    ? "Type a tag and press Enter..."
                    : "Add another..."
                }
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => {
                  if (tagInput.trim()) addTag(tagInput);
                }}
              />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isUnique}
              onChange={(e) => updateField("isUnique", e.target.checked)}
              className="accent-brand-500 w-4 h-4"
            />
            <div>
              <span className="text-sm text-zinc-200">Unique listing</span>
              <p className="text-2xs text-zinc-500">
                Mark if this API has no direct alternatives on the marketplace
              </p>
            </div>
          </label>
        </section>

        {/* ─── Samples ─── */}
        <section className="card p-6 space-y-5">
          <SectionHeader title="Sample Request / Response" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel
                label="Sample Request (JSON)"
                error={errors.sampleRequest}
              />
              <textarea
                className={cn(
                  "input-base w-full min-h-[160px] font-mono text-xs resize-y",
                  errors.sampleRequest && "border-red-500/50"
                )}
                placeholder='{ "query": "San Francisco weather" }'
                value={form.sampleRequest}
                onChange={(e) => updateField("sampleRequest", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel
                label="Sample Response (JSON)"
                error={errors.sampleResponse}
              />
              <textarea
                className={cn(
                  "input-base w-full min-h-[160px] font-mono text-xs resize-y",
                  errors.sampleResponse && "border-red-500/50"
                )}
                placeholder='{ "temperature": 72, "unit": "F" }'
                value={form.sampleResponse}
                onChange={(e) => updateField("sampleResponse", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ─── Submit ─── */}
        {submitError && (
          <div className="card border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push("/provider/listings")}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "btn-primary min-w-[140px]",
              isSubmitting && "opacity-60 cursor-not-allowed"
            )}
          >
            {isSubmitting ? "Saving..." : "Save as Draft"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Shared Sub-components ───

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
      {title}
    </h2>
  );
}

function FieldLabel({
  label,
  error,
  info,
}: {
  label: string;
  error?: string;
  info?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
          {label}
        </label>
        {info && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-zinc-600 text-zinc-500 hover:text-zinc-300 hover:border-zinc-400 text-[10px] font-bold leading-none transition-colors"
              aria-label={`Info about ${label}`}
            >
              !
            </button>
            {showInfo && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 px-3 py-2 rounded-lg bg-surface-3 border border-surface-4 text-xs text-zinc-300 shadow-lg z-10">
                {info}
                <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-surface-3 border-b border-r border-surface-4 rotate-45 -mt-1" />
              </div>
            )}
          </div>
        )}
      </div>
      {error && <span className="text-2xs text-red-400">{error}</span>}
    </div>
  );
}
