"use client";

import { useReducer, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { provider, marketplace } from "@/lib/api";
import { cn } from "@/lib/utils";
import McpPreviewPanel from "@/components/provider/McpPreviewPanel";
import type { ListingType, DetectEndpoint, DetectResponse, InputSchemaField } from "@/types";

// ─── Constants ───

interface Category {
  id: string;
  slug: string;
  name: string;
  depth: number;
}

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

const CATEGORY_PRICING: Record<string, { floor: number; ceiling: number }> = {
  "language-models": { floor: 0.003, ceiling: 0.05 },
  "translation": { floor: 0.001, ceiling: 0.01 },
  "sentiment-analysis": { floor: 0.0005, ceiling: 0.005 },
  "embeddings": { floor: 0.0001, ceiling: 0.002 },
  "object-detection": { floor: 0.002, ceiling: 0.02 },
  "datasets": { floor: 0.01, ceiling: 0.10 },
};
const DEFAULT_PRICING = { floor: 0.001, ceiling: 0.01 };

// ─── Detection Stages ───

type DetectStage =
  | "idle"
  | "fetching"     // Fetching spec...
  | "analyzing"    // Analyzing endpoints...
  | "generating"   // Generating preview...
  | "done"         // Done
  | "failed";

const STAGE_LABELS: Record<DetectStage, string> = {
  idle: "",
  fetching: "Fetching spec...",
  analyzing: "Analyzing endpoints...",
  generating: "Generating preview...",
  done: "Done",
  failed: "Detection failed",
};

// ─── Wizard State ───

interface WizardFormData {
  // Step 1
  specUrl: string;
  detected: boolean;
  name: string;
  description: string;
  listingType: ListingType;
  categoryId: string;
  baseUrl: string;
  healthCheckUrl: string;
  docsUrl: string;
  authType: string;
  sampleRequest: string;
  sampleResponse: string;
  endpoints: DetectEndpoint[];
  inputSchemaFields: InputSchemaField[];
  // Step 2
  floorPrice: string;
  ceilingPrice: string;
  capacityPerMinute: string;
  // Step 3
  payoutAddress: string;
}

type WizardAction =
  | { type: "SET_FIELD"; field: keyof WizardFormData; value: WizardFormData[keyof WizardFormData] }
  | { type: "SET_DETECTION_RESULT"; result: DetectResponse; categories: Category[] }
  | { type: "RESET" };

const INITIAL_STATE: WizardFormData = {
  specUrl: "",
  detected: false,
  name: "",
  description: "",
  listingType: "REST_API",
  categoryId: "",
  baseUrl: "",
  healthCheckUrl: "",
  docsUrl: "",
  authType: "api_key",
  sampleRequest: "",
  sampleResponse: "",
  endpoints: [],
  inputSchemaFields: [],
  floorPrice: "",
  ceilingPrice: "",
  capacityPerMinute: "60",
  payoutAddress: "",
};

function wizardReducer(state: WizardFormData, action: WizardAction): WizardFormData {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_DETECTION_RESULT": {
      const r = action.result;
      let categoryId = state.categoryId;
      if (r.suggestedCategorySlug) {
        const match = action.categories.find((c) => c.slug === r.suggestedCategorySlug);
        if (match) categoryId = match.id;
      }
      const catSlug = r.suggestedCategorySlug || "";
      const pricing = CATEGORY_PRICING[catSlug] || DEFAULT_PRICING;

      return {
        ...state,
        detected: r.detected,
        name: r.name || state.name,
        description: r.description || state.description,
        listingType: (r.listingType as ListingType) || state.listingType,
        categoryId,
        baseUrl: r.baseUrl || state.baseUrl,
        healthCheckUrl: r.healthCheckUrl || state.healthCheckUrl,
        docsUrl: r.docsUrl || state.docsUrl,
        authType: r.authType || state.authType,
        sampleRequest: r.sampleRequest ? JSON.stringify(r.sampleRequest, null, 2) : state.sampleRequest,
        sampleResponse: r.sampleResponse ? JSON.stringify(r.sampleResponse, null, 2) : state.sampleResponse,
        endpoints: r.endpoints || [],
        inputSchemaFields: r.inputSchemaFields || [],
        floorPrice: state.floorPrice || pricing.floor.toString(),
        ceilingPrice: state.ceilingPrice || pricing.ceiling.toString(),
      };
    }
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ─── Step Indicator ───

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { num: 1, label: "API Details" },
    { num: 2, label: "Pricing" },
    { num: 3, label: "Wallet" },
  ];

  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-all",
              current === step.num
                ? "bg-brand-600 text-white"
                : current > step.num
                  ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/30"
                  : "bg-surface-3 text-zinc-500 border border-surface-4"
            )}
          >
            {current > step.num ? "\u2713" : step.num}
          </div>
          <span
            className={cn(
              "text-sm font-medium",
              current === step.num ? "text-zinc-200" : "text-zinc-500"
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-12 h-px mx-1",
                current > step.num ? "bg-emerald-600/40" : "bg-surface-4"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Detection Progress ───

function DetectionProgress({ stage, endpointCount, healthStatus }: {
  stage: DetectStage;
  endpointCount: number;
  healthStatus: { ok: boolean; latencyMs: number } | null;
}) {
  if (stage === "idle") return null;

  const stages: DetectStage[] = ["fetching", "analyzing", "generating"];
  const currentIdx = stages.indexOf(stage);
  const isDoneOrFailed = stage === "done" || stage === "failed";

  return (
    <div className="bg-surface-2 border border-surface-4 rounded-lg p-4 space-y-2.5">
      {stages.map((s, i) => {
        const isActive = s === stage;
        const isDone = isDoneOrFailed || currentIdx > i;
        const isPending = !isDone && !isActive;

        let label = STAGE_LABELS[s];
        if (s === "analyzing" && isDone && endpointCount > 0) {
          label = `${endpointCount} endpoint${endpointCount !== 1 ? "s" : ""} found`;
        }
        if (s === "generating" && isDone) {
          label = "Preview ready";
        }

        return (
          <div key={s} className="flex items-center gap-2.5 text-sm">
            {isActive && !isDoneOrFailed && (
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-zinc-600 border-t-brand-400 rounded-full flex-shrink-0" />
            )}
            {isDone && (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-emerald-400 text-xs flex-shrink-0">
                &#10003;
              </span>
            )}
            {isPending && (
              <span className="w-3.5 h-3.5 rounded-full border border-zinc-700 flex-shrink-0" />
            )}
            <span className={cn(
              isDone ? "text-emerald-400" : isActive ? "text-zinc-200" : "text-zinc-600",
              "transition-colors duration-300"
            )}>
              {label}
            </span>
          </div>
        );
      })}

      {/* Health check result — shown as a bonus line when done */}
      {isDoneOrFailed && healthStatus && (
        <div className="flex items-center gap-2.5 text-sm border-t border-surface-4 pt-2 mt-1">
          <span className={cn(
            "w-3.5 h-3.5 flex items-center justify-center text-xs flex-shrink-0",
            healthStatus.ok ? "text-emerald-400" : "text-amber-400"
          )}>
            {healthStatus.ok ? "\u2713" : "!"}
          </span>
          <span className={healthStatus.ok ? "text-emerald-400" : "text-amber-400"}>
            {healthStatus.ok
              ? `Health check passed (${healthStatus.latencyMs}ms)`
              : `Health check failed (${healthStatus.latencyMs}ms)`
            }
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───

export default function CreateListingPage() {
  const router = useRouter();
  const [form, dispatch] = useReducer(wizardReducer, INITIAL_STATE);
  const [currentStep, setCurrentStep] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFields, setShowFields] = useState(false); // collapsed until detect or manual toggle

  // Detection state
  const [detectStage, setDetectStage] = useState<DetectStage>("idle");
  const [detectWarnings, setDetectWarnings] = useState<string[]>([]);
  const [endpointCount, setEndpointCount] = useState(0);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Load categories
  useEffect(() => {
    marketplace.getCategories().then(setCategories).catch(console.error);
  }, []);

  const setField = useCallback(
    <K extends keyof WizardFormData>(field: K, value: WizardFormData[K]) => {
      dispatch({ type: "SET_FIELD", field, value });
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  // ─── Auto-detect with staged progress ───
  const handleDetect = useCallback(async () => {
    if (!form.specUrl.trim()) return;

    // Reset
    setDetectWarnings([]);
    setEndpointCount(0);
    setHealthStatus(null);
    for (const t of stageTimerRef.current) clearTimeout(t);
    stageTimerRef.current = [];

    // Animate through 3 stages while the single API call runs.
    // Minimum 1.5s total so the animation feels intentional.
    const startedAt = Date.now();
    setDetectStage("fetching");
    stageTimerRef.current.push(
      setTimeout(() => setDetectStage("analyzing"), 600),
      setTimeout(() => setDetectStage("generating"), 1200),
    );

    try {
      const result = await provider.detectSpec(form.specUrl.trim());

      // Ensure minimum animation time so stages complete visually
      const elapsed = Date.now() - startedAt;
      const minDelay = Math.max(0, 1500 - elapsed);

      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, minDelay);
        stageTimerRef.current.push(t);
      });

      // Clear all stage timers
      for (const t of stageTimerRef.current) clearTimeout(t);
      stageTimerRef.current = [];

      // Populate all fields simultaneously and reveal them
      dispatch({ type: "SET_DETECTION_RESULT", result, categories });
      setEndpointCount(result.endpoints.length);
      setHealthStatus(result.healthCheckStatus);
      setShowFields(true);

      if (result.detected || result.name) {
        setDetectStage("done");
      } else {
        setDetectStage("failed");
      }

      if (result.warnings.length > 0) {
        setDetectWarnings(result.warnings);
      }
    } catch (err: unknown) {
      for (const t of stageTimerRef.current) clearTimeout(t);
      stageTimerRef.current = [];
      const msg = err instanceof Error ? err.message : "Detection failed";
      setDetectWarnings([msg]);
      setDetectStage("failed");
    }
  }, [form.specUrl, categories]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      for (const t of stageTimerRef.current) clearTimeout(t);
    };
  }, []);

  // ─── Validation ───
  const validateStep = useCallback(
    (step: number): boolean => {
      const errs: Record<string, string> = {};
      if (step === 1) {
        if (!form.name.trim()) errs.name = "Name is required";
        if (!form.description.trim()) errs.description = "Description is required";
        if (!form.categoryId) errs.categoryId = "Category is required";
        if (!form.baseUrl.trim()) errs.baseUrl = "Base URL is required";
      } else if (step === 2) {
        if (!form.floorPrice || parseFloat(form.floorPrice) <= 0)
          errs.floorPrice = "Floor price must be greater than 0";
        if (form.ceilingPrice && parseFloat(form.ceilingPrice) <= parseFloat(form.floorPrice))
          errs.ceilingPrice = "Ceiling must be greater than floor";
      } else if (step === 3) {
        if (!form.payoutAddress.trim())
          errs.payoutAddress = "Payout address is required";
        else if (!/^0x[a-fA-F0-9]{40}$/.test(form.payoutAddress))
          errs.payoutAddress = "Invalid Ethereum address";
      }
      setErrors(errs);
      return Object.keys(errs).length === 0;
    },
    [form]
  );

  const handleNext = useCallback(() => {
    // If fields are hidden, show them first so validation errors are visible
    if (currentStep === 1 && !showFields) {
      setShowFields(true);
      // Let the fields render, then validate on next tick
      setTimeout(() => {
        // Re-run validation will show errors on the now-visible fields
      }, 0);
      return;
    }
    if (validateStep(currentStep)) {
      setCurrentStep((s) => Math.min(s + 1, 3));
    }
  }, [currentStep, validateStep, showFields]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
    setErrors({});
  }, []);

  // ─── Submit ───
  const handleSubmit = useCallback(async () => {
    if (!validateStep(3)) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let sampleRequest = null;
      let sampleResponse = null;
      if (form.sampleRequest.trim()) {
        try { sampleRequest = JSON.parse(form.sampleRequest); }
        catch { /* skip invalid */ }
      }
      if (form.sampleResponse.trim()) {
        try { sampleResponse = JSON.parse(form.sampleResponse); }
        catch { /* skip invalid */ }
      }

      await provider.createListing({
        name: form.name,
        slug: "",
        listingType: form.listingType,
        categoryId: form.categoryId,
        sectors: [],
        description: form.description,
        baseUrl: form.baseUrl,
        healthCheckUrl: form.healthCheckUrl || undefined,
        docsUrl: form.docsUrl || undefined,
        authType: form.authType,
        floorPriceUsdc: parseFloat(form.floorPrice),
        ceilingPriceUsdc: form.ceilingPrice ? parseFloat(form.ceilingPrice) : undefined,
        capacityPerMinute: parseInt(form.capacityPerMinute, 10) || 60,
        tags: [],
        isUnique: false,
        sampleRequest,
        sampleResponse,
      });

      if (form.payoutAddress) {
        try { await provider.updatePayoutAddress(form.payoutAddress); }
        catch { /* non-blocking */ }
      }

      router.push("/provider/listings?created=1");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create listing";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [form, validateStep, router]);

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const categorySlug = selectedCategory?.slug || "";
  const categoryPricing = CATEGORY_PRICING[categorySlug] || DEFAULT_PRICING;
  const isDetecting = detectStage !== "idle" && detectStage !== "done" && detectStage !== "failed";

  return (
    <div className="max-w-7xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push("/provider/listings")}
          className="btn-ghost text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back
        </button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deploy Your API</h1>
          <p className="mt-1 text-zinc-400">
            One URL in, live MCP tool out, USDC flowing.
          </p>
        </div>
      </div>

      <div className="flex gap-8">
        {/* ── LEFT: Steps ── */}
        <div className="flex-1 min-w-0">
          <StepIndicator current={currentStep} />

          {/* ═══ Step 1: API Details ═══ */}
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* URL + Auto-Detect — always visible */}
              <section className="card p-6 space-y-4">
                <h2 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
                  API Spec URL
                </h2>
                <p className="text-sm text-zinc-500">
                  Paste your OpenAPI spec URL and we&rsquo;ll auto-detect everything.
                </p>
                <div className="flex gap-3">
                  <input
                    className="input-base flex-1"
                    placeholder="https://api.example.com/openapi.json"
                    value={form.specUrl}
                    onChange={(e) => setField("specUrl", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleDetect(); }
                    }}
                    disabled={isDetecting}
                  />
                  <button
                    type="button"
                    onClick={handleDetect}
                    disabled={isDetecting || !form.specUrl.trim()}
                    className={cn(
                      "btn-primary whitespace-nowrap min-w-[130px]",
                      (isDetecting || !form.specUrl.trim()) && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {isDetecting ? STAGE_LABELS[detectStage] : "Auto-Detect"}
                  </button>
                </div>

                {/* Multi-stage progress */}
                <DetectionProgress
                  stage={detectStage}
                  endpointCount={endpointCount}
                  healthStatus={healthStatus}
                />

                {/* Warnings */}
                {detectWarnings.length > 0 && !isDetecting && (
                  <div className="text-sm text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 space-y-1">
                    {detectWarnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                )}

                {/* Manual entry escape hatch — only before detection or fields shown */}
                {!showFields && detectStage === "idle" && (
                  <button
                    type="button"
                    onClick={() => setShowFields(true)}
                    className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    or fill in manually &darr;
                  </button>
                )}
              </section>

              {/* Editable fields — collapsed until detect completes or manual toggle */}
              {showFields && (
                <>
                  <section className="card p-6 space-y-5 animate-fade-in">
                    <h2 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
                      API Details
                      {form.detected && (
                        <span className="ml-2 text-2xs text-emerald-400 font-normal">
                          auto-filled from spec
                        </span>
                      )}
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel label="Name" error={errors.name} />
                        <input
                          className={cn("input-base w-full", errors.name && "border-red-500/50")}
                          placeholder="My Weather API"
                          value={form.name}
                          onChange={(e) => setField("name", e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel label="Category" error={errors.categoryId} />
                        <select
                          className={cn("input-base w-full", errors.categoryId && "border-red-500/50")}
                          value={form.categoryId}
                          onChange={(e) => setField("categoryId", e.target.value)}
                        >
                          <option value="">Select category...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {"\u00A0".repeat(c.depth * 2)}{c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <FieldLabel label="Description" error={errors.description} />
                      <textarea
                        className={cn("input-base w-full min-h-[120px] resize-y", errors.description && "border-red-500/50")}
                        placeholder="What does your API do? This becomes the MCP tool description agents will read."
                        value={form.description}
                        onChange={(e) => setField("description", e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel label="Listing Type" />
                        <select
                          className="input-base w-full"
                          value={form.listingType}
                          onChange={(e) => setField("listingType", e.target.value as ListingType)}
                        >
                          {LISTING_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <FieldLabel label="Auth Type" />
                        <select
                          className="input-base w-full"
                          value={form.authType}
                          onChange={(e) => setField("authType", e.target.value)}
                        >
                          {AUTH_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel label="Base URL" error={errors.baseUrl} />
                        <input
                          className={cn("input-base w-full", errors.baseUrl && "border-red-500/50")}
                          placeholder="https://api.example.com/v1"
                          value={form.baseUrl}
                          onChange={(e) => setField("baseUrl", e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel label="Health Check URL" />
                        <input
                          className="input-base w-full"
                          placeholder="https://api.example.com/health"
                          value={form.healthCheckUrl}
                          onChange={(e) => setField("healthCheckUrl", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <FieldLabel label="Docs URL" />
                      <input
                        className="input-base w-full"
                        placeholder="https://docs.example.com"
                        value={form.docsUrl}
                        onChange={(e) => setField("docsUrl", e.target.value)}
                      />
                    </div>
                  </section>

                  {/* Advanced: Sample Request/Response */}
                  <section className="card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="w-full flex items-center justify-between p-4 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <span className="font-medium">
                        Advanced
                        {(form.sampleRequest || form.sampleResponse) && (
                          <span className="ml-2 text-2xs text-emerald-400">
                            {form.detected ? "(auto-filled)" : "(has data)"}
                          </span>
                        )}
                      </span>
                      <span className={cn("transition-transform", showAdvanced && "rotate-180")}>
                        &#9662;
                      </span>
                    </button>
                    {showAdvanced && (
                      <div className="px-4 pb-4 space-y-4 border-t border-surface-4 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <FieldLabel label="Sample Request (JSON)" />
                            <textarea
                              className="input-base w-full min-h-[100px] font-mono text-xs resize-y"
                              placeholder='{ "query": "hello" }'
                              value={form.sampleRequest}
                              onChange={(e) => setField("sampleRequest", e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel label="Sample Response (JSON)" />
                            <textarea
                              className="input-base w-full min-h-[100px] font-mono text-xs resize-y"
                              placeholder='{ "result": "world" }'
                              value={form.sampleResponse}
                              onChange={(e) => setField("sampleResponse", e.target.value)}
                            />
                          </div>
                        </div>
                        <p className="text-2xs text-zinc-600">
                          These are inferred from the spec automatically when available.
                          Edit only if auto-detection got them wrong.
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          )}

          {/* ═══ Step 2: Pricing ═══ */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="card border-brand-600/20 bg-brand-600/5 p-4">
                <p className="text-sm text-zinc-300">
                  Similar APIs in{" "}
                  <span className="text-brand-300 font-medium">
                    {selectedCategory?.name || "this category"}
                  </span>{" "}
                  are priced{" "}
                  <span className="font-mono text-emerald-400">
                    ${categoryPricing.floor.toFixed(4)}
                  </span>
                  {" "}&ndash;{" "}
                  <span className="font-mono text-emerald-400">
                    ${categoryPricing.ceiling.toFixed(4)}
                  </span>
                  {" "}USDC/call
                </p>
              </div>

              <section className="card p-6 space-y-5">
                <h2 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
                  Pricing (USDC per call)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <FieldLabel label="Floor Price" error={errors.floorPrice} />
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      className={cn("input-base w-full font-mono", errors.floorPrice && "border-red-500/50")}
                      placeholder="0.001"
                      value={form.floorPrice}
                      onChange={(e) => setField("floorPrice", e.target.value)}
                    />
                    <p className="text-2xs text-zinc-500 mt-1">Minimum price per API call</p>
                  </div>
                  <div>
                    <FieldLabel label="Ceiling Price" error={errors.ceilingPrice} />
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      className={cn("input-base w-full font-mono", errors.ceilingPrice && "border-red-500/50")}
                      placeholder="0.01"
                      value={form.ceilingPrice}
                      onChange={(e) => setField("ceilingPrice", e.target.value)}
                    />
                    <p className="text-2xs text-zinc-500 mt-1">Maximum during high demand</p>
                  </div>
                  <div>
                    <FieldLabel label="Capacity / min" />
                    <input
                      type="number"
                      min="1"
                      className="input-base w-full font-mono"
                      placeholder="60"
                      value={form.capacityPerMinute}
                      onChange={(e) => setField("capacityPerMinute", e.target.value)}
                    />
                    <p className="text-2xs text-zinc-500 mt-1">Requests per minute limit</p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ═══ Step 3: Wallet ═══ */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <section className="card p-6 space-y-5">
                <h2 className="text-lg font-semibold text-zinc-100 border-b border-surface-4 pb-3">
                  Payout Wallet
                </h2>

                <div>
                  <FieldLabel label="Payout Address (Base L2)" error={errors.payoutAddress} />
                  <input
                    className={cn("input-base w-full font-mono text-sm", errors.payoutAddress && "border-red-500/50")}
                    placeholder="0x..."
                    value={form.payoutAddress}
                    onChange={(e) => setField("payoutAddress", e.target.value)}
                  />
                  <p className="text-2xs text-zinc-500 mt-1">
                    USDC earnings will be sent to this address on Base L2
                  </p>
                </div>
              </section>

              {/* Payout preview — makes the money real */}
              <PayoutPreview
                floorPrice={form.floorPrice}
                ceilingPrice={form.ceilingPrice}
                payoutAddress={form.payoutAddress}
              />

              <div className="card border-surface-4 bg-surface-2 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-zinc-300">Need a wallet?</h3>
                <p className="text-xs text-zinc-500">
                  You can create a Coinbase Developer Platform (CDP) wallet for programmatic payouts.
                  CDP wallet creation is handled server-side via the MCP server. Contact support or use
                  your existing Base L2 wallet address.
                </p>
              </div>

              {submitError && (
                <div className="card border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* ─── Navigation ─── */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {currentStep > 1 && (
                <button type="button" onClick={handleBack} className="btn-secondary">
                  &larr; Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/provider/listings")}
                className="btn-ghost text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
              {currentStep < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary min-w-[120px]"
                >
                  Next &rarr;
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className={cn(
                    "btn-primary min-w-[160px]",
                    isSubmitting && "opacity-60 cursor-not-allowed"
                  )}
                >
                  {isSubmitting ? "Deploying..." : "Deploy as Draft"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: MCP Preview ── */}
        <div className="hidden lg:block w-[420px] flex-shrink-0">
          <div className="sticky top-8">
            <div className="card p-5">
              <McpPreviewPanel
                name={form.name}
                description={form.description}
                sampleRequest={form.sampleRequest}
                endpoints={form.endpoints}
                inputSchemaFields={form.inputSchemaFields}
                floorPrice={form.floorPrice}
                ceilingPrice={form.ceilingPrice}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Payout Preview ───

const NEXUS_FEE_PERCENT = 15;

function PayoutPreview({ floorPrice, ceilingPrice, payoutAddress }: {
  floorPrice: string;
  ceilingPrice: string;
  payoutAddress: string;
}) {
  const floor = parseFloat(floorPrice) || 0;
  const ceiling = parseFloat(ceilingPrice) || 0;
  const avgPrice = ceiling > 0 ? (floor + ceiling) / 2 : floor;
  if (avgPrice <= 0) return null;

  const calls = 100;
  const gross = calls * avgPrice;
  const fee = gross * (NEXUS_FEE_PERCENT / 100);
  const net = gross - fee;

  const addrDisplay = payoutAddress && /^0x[a-fA-F0-9]{40}$/.test(payoutAddress)
    ? `${payoutAddress.slice(0, 6)}...${payoutAddress.slice(-4)}`
    : "your wallet";

  return (
    <div className="card border-emerald-500/20 bg-emerald-500/5 p-5 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-200">
        Your first payout preview
      </h3>
      <div className="space-y-1.5 text-sm font-mono">
        <div className="flex items-center justify-between text-zinc-300">
          <span>{calls} calls &times; ${avgPrice.toFixed(4)} avg</span>
          <span className="text-zinc-200">${gross.toFixed(4)}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span>Nexus fee ({NEXUS_FEE_PERCENT}%)</span>
          <span>-${fee.toFixed(4)}</span>
        </div>
        <div className="border-t border-emerald-500/20 pt-1.5 flex items-center justify-between">
          <span className="text-emerald-400 font-semibold">You receive</span>
          <span className="text-emerald-400 font-semibold">
            ${net.toFixed(4)} USDC
          </span>
        </div>
      </div>
      <p className="text-2xs text-zinc-500">
        Settled to <span className="font-mono text-zinc-400">{addrDisplay}</span> on Base L2
      </p>
    </div>
  );
}

// ─── Shared Sub-components ───

function FieldLabel({ label, error }: { label: string; error?: string }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
        {label}
      </label>
      {error && <span className="text-2xs text-red-400">{error}</span>}
    </div>
  );
}
