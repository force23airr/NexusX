"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface DiscoveryMetadataFormValue {
  tags: string[];
  intents: string[];
  availabilityRegions: string[];
  restrictedRegions: string[];
  complianceTags: string[];
  capabilityTags: string[];
  inputModalities: string[];
  outputModalities: string[];
  latencyRegions: string[];
  routingRegions: string[];
  edgeRegions: string[];
  domainMetadataText: string;
}

export const INPUT_MODALITY_OPTIONS = [
  "text",
  "image",
  "audio",
  "video",
  "structured-data",
] as const;

export const OUTPUT_MODALITY_OPTIONS = [
  "text",
  "image",
  "audio",
  "structured-data",
  "binary",
] as const;

const CAPABILITY_SUGGESTIONS = [
  "search",
  "translate",
  "summarize",
  "embed",
  "classify",
  "extract",
  "transcribe",
  "generate",
];

const COMPLIANCE_SUGGESTIONS = [
  "gdpr",
  "hipaa",
  "soc2",
  "pci-dss",
  "iso27001",
] as const;

const REGION_SUGGESTIONS = ["US", "JP", "SG", "GB", "DE", "IN"] as const;
const ROUTING_REGION_SUGGESTIONS = ["NA", "LATAM", "EU", "MEA", "APAC", "US", "JP", "SG"] as const;

type FieldKey = keyof DiscoveryMetadataFormValue;

interface Props {
  value: DiscoveryMetadataFormValue;
  errors?: Record<string, string>;
  onChange: (field: FieldKey, value: DiscoveryMetadataFormValue[FieldKey]) => void;
}

function normalizeToken(value: string, uppercase = false): string {
  const trimmed = value.trim().replace(/,$/, "");
  if (!trimmed) return "";
  const normalized = uppercase ? trimmed.toUpperCase() : trimmed.toLowerCase();
  return normalized.replace(/\s+/g, "-");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueTokens(values: string[], uppercase = false): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeToken(value, uppercase))
        .filter(Boolean),
    ),
  );
}

export interface RoutingMetadataValue {
  latencyRegions: string[];
  routingRegions: string[];
  edgeRegions: string[];
}

function readRoutingArray(source: Record<string, unknown>, key: keyof RoutingMetadataValue): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return uniqueTokens(
    value.filter((entry): entry is string => typeof entry === "string"),
    true,
  );
}

export function extractRoutingMetadata(value: unknown): RoutingMetadataValue {
  if (!isPlainObject(value)) {
    return {
      latencyRegions: [],
      routingRegions: [],
      edgeRegions: [],
    };
  }

  const nestedRouting = isPlainObject(value.nexusxRouting) ? value.nexusxRouting : null;
  return {
    latencyRegions: uniqueTokens(
      [...readRoutingArray(value, "latencyRegions"), ...readRoutingArray(nestedRouting ?? {}, "latencyRegions")],
      true,
    ),
    routingRegions: uniqueTokens(
      [...readRoutingArray(value, "routingRegions"), ...readRoutingArray(nestedRouting ?? {}, "routingRegions")],
      true,
    ),
    edgeRegions: uniqueTokens(
      [...readRoutingArray(value, "edgeRegions"), ...readRoutingArray(nestedRouting ?? {}, "edgeRegions")],
      true,
    ),
  };
}

function stripRoutingMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;

  const next: Record<string, unknown> = { ...value };
  delete next.latencyRegions;
  delete next.routingRegions;
  delete next.edgeRegions;

  if (isPlainObject(next.nexusxRouting)) {
    const nested = { ...next.nexusxRouting };
    delete nested.latencyRegions;
    delete nested.routingRegions;
    delete nested.edgeRegions;
    if (Object.keys(nested).length > 0) {
      next.nexusxRouting = nested;
    } else {
      delete next.nexusxRouting;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function stringifyDomainMetadata(value: unknown): string {
  const stripped = stripRoutingMetadata(value);
  if (!stripped) {
    return "";
  }
  return JSON.stringify(stripped, null, 2);
}

export function parseDomainMetadataText(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Domain metadata must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Domain metadata must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export function buildDiscoveryDomainMetadata(input: {
  domainMetadataText: string;
  latencyRegions: string[];
  routingRegions: string[];
  edgeRegions: string[];
}): Record<string, unknown> | undefined {
  const base = stripRoutingMetadata(parseDomainMetadataText(input.domainMetadataText)) ?? {};
  const latencyRegions = uniqueTokens(input.latencyRegions, true);
  const routingRegions = uniqueTokens(input.routingRegions, true);
  const edgeRegions = uniqueTokens(input.edgeRegions, true);

  if (latencyRegions.length > 0 || routingRegions.length > 0 || edgeRegions.length > 0) {
    const nestedRouting = isPlainObject(base.nexusxRouting)
      ? { ...base.nexusxRouting }
      : {};
    if (latencyRegions.length > 0) nestedRouting.latencyRegions = latencyRegions;
    if (routingRegions.length > 0) nestedRouting.routingRegions = routingRegions;
    if (edgeRegions.length > 0) nestedRouting.edgeRegions = edgeRegions;
    base.nexusxRouting = nestedRouting;
  }

  return Object.keys(base).length > 0 ? base : undefined;
}

export default function DiscoveryMetadataFields({ value, errors, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TokenField
          label="Tags"
          help="Broad discovery terms agents may use in search."
          placeholder="weather, embeddings, trading"
          values={value.tags}
          onChange={(next) => onChange("tags", next)}
        />
        <TokenField
          label="Intents"
          help="Concrete tasks an agent can complete with this API."
          placeholder="translate-document, detect-sentiment"
          values={value.intents}
          onChange={(next) => onChange("intents", next)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TokenField
          label="Capability Tags"
          help="Hard capability filters used during discovery."
          placeholder="search, extract, transcribe"
          values={value.capabilityTags}
          suggestions={CAPABILITY_SUGGESTIONS}
          onChange={(next) => onChange("capabilityTags", next)}
        />
        <TokenField
          label="Compliance Tags"
          help="Certifications or policy constraints agents may require."
          placeholder="gdpr, soc2"
          values={value.complianceTags}
          suggestions={COMPLIANCE_SUGGESTIONS}
          onChange={(next) => onChange("complianceTags", next)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TokenField
          label="Availability Regions"
          help="Leave empty for global. Use ISO country codes."
          placeholder="US, JP, SG"
          values={value.availabilityRegions}
          suggestions={REGION_SUGGESTIONS}
          uppercase
          onChange={(next) => onChange("availabilityRegions", next)}
        />
        <TokenField
          label="Restricted Regions"
          help="Countries where this API must not be surfaced."
          placeholder="CN, RU"
          values={value.restrictedRegions}
          suggestions={REGION_SUGGESTIONS}
          uppercase
          onChange={(next) => onChange("restrictedRegions", next)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TokenField
          label="Latency Regions"
          help="Regions where latency is strongest. Macro regions or exact countries."
          placeholder="APAC, EU, US"
          values={value.latencyRegions}
          suggestions={ROUTING_REGION_SUGGESTIONS}
          uppercase
          onChange={(next) => onChange("latencyRegions", next)}
        />
        <TokenField
          label="Routing Regions"
          help="Regions where traffic is actively routed or served."
          placeholder="NA, EU"
          values={value.routingRegions}
          suggestions={ROUTING_REGION_SUGGESTIONS}
          uppercase
          onChange={(next) => onChange("routingRegions", next)}
        />
        <TokenField
          label="Edge Regions"
          help="Edge or POP coverage hints for agents choosing low-latency APIs."
          placeholder="SG, JP, DE"
          values={value.edgeRegions}
          suggestions={ROUTING_REGION_SUGGESTIONS}
          uppercase
          onChange={(next) => onChange("edgeRegions", next)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TokenField
          label="Input Modalities"
          help="What the API accepts."
          placeholder="text, image"
          values={value.inputModalities}
          suggestions={INPUT_MODALITY_OPTIONS}
          onChange={(next) => onChange("inputModalities", next)}
        />
        <TokenField
          label="Output Modalities"
          help="What the API returns."
          placeholder="text, structured-data"
          values={value.outputModalities}
          suggestions={OUTPUT_MODALITY_OPTIONS}
          onChange={(next) => onChange("outputModalities", next)}
        />
      </div>

      <div>
        <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
          Domain Metadata
        </label>
        <textarea
          className={cn(
            "input-base w-full min-h-[140px] font-mono text-xs resize-y",
            errors?.domainMetadataText && "border-red-500/50",
          )}
          placeholder={`{\n  "useCases": ["agent-routing"],\n  "supportsBatch": true\n}`}
          value={value.domainMetadataText}
          onChange={(event) => onChange("domainMetadataText", event.target.value)}
        />
        <p className="text-2xs text-zinc-500 mt-1">
          Optional JSON object for vertical-specific metadata that does not belong in the core schema.
        </p>
        {errors?.domainMetadataText && (
          <p className="text-2xs text-red-400 mt-1">{errors.domainMetadataText}</p>
        )}
      </div>
    </div>
  );
}

function TokenField(props: {
  label: string;
  help: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  suggestions?: readonly string[];
  uppercase?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const normalized = normalizeToken(raw, props.uppercase);
    if (!normalized) return;
    if (props.values.includes(normalized)) {
      setDraft("");
      return;
    }
    props.onChange([...props.values, normalized]);
    setDraft("");
  };

  const remove = (value: string) => {
    props.onChange(props.values.filter((entry) => entry !== value));
  };

  return (
    <div>
      <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
        {props.label}
      </label>
      <p className="text-2xs text-zinc-500 mb-2">{props.help}</p>

      {props.values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {props.values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-3 text-zinc-300 border border-surface-4 rounded text-xs"
            >
              {value}
              <button
                type="button"
                onClick={() => remove(value)}
                className="text-zinc-500 hover:text-red-400 ml-0.5"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="input-base w-full"
        placeholder={props.placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
      />

      {props.suggestions && props.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {props.suggestions.map((suggestion) => {
            const normalized = normalizeToken(suggestion, props.uppercase);
            const active = props.values.includes(normalized);
            return (
              <button
                key={suggestion}
                type="button"
                onClick={() => (active ? remove(normalized) : commit(suggestion))}
                className={cn(
                  "px-2 py-1 rounded-md text-2xs border transition-colors",
                  active
                    ? "border-brand-500/40 bg-brand-500/10 text-brand-300"
                    : "border-surface-4 bg-surface-2 text-zinc-500 hover:text-zinc-300",
                )}
              >
                {suggestion}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
