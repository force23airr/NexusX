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

export function stringifyDomainMetadata(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  return JSON.stringify(value, null, 2);
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
