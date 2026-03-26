"use client";

import { cn } from "@/lib/utils";
import type {
  ListingRiskLevel,
  ListingSideEffectLevel,
} from "@/types";

export interface ListingContractFormValue {
  authSchemes: string[];
  interactionModes: string[];
  humanApprovalRequired: boolean;
  noHealthProbe: boolean;
  riskLevel: ListingRiskLevel;
  sideEffectLevel: ListingSideEffectLevel;
}

type FieldKey = keyof ListingContractFormValue;

interface Props {
  value: ListingContractFormValue;
  onChange: (field: FieldKey, value: ListingContractFormValue[FieldKey]) => void;
}

const AUTH_SCHEME_SUGGESTIONS = [
  "api_key",
  "oauth2",
  "jwt",
  "bearer_token",
  "basic_auth",
  "x402",
  "none",
] as const;

const INTERACTION_MODE_SUGGESTIONS = [
  "sync",
  "async",
  "streaming",
  "batch",
  "webhook",
] as const;

const RISK_LEVEL_OPTIONS: Array<{ value: ListingRiskLevel; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const SIDE_EFFECT_OPTIONS: Array<{ value: ListingSideEffectLevel; label: string }> = [
  { value: "READ_ONLY", label: "Read-only" },
  { value: "REVERSIBLE", label: "Reversible" },
  { value: "IRREVERSIBLE", label: "Irreversible" },
];

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function uniqueTokens(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeToken).filter(Boolean)));
}

function TokenField({
  label,
  help,
  values,
  suggestions,
  onChange,
}: {
  label: string;
  help: string;
  values: string[];
  suggestions?: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
        {label}
      </label>
      <input
        className="input-base w-full"
        value={values.join(", ")}
        onChange={(e) => onChange(uniqueTokens(e.target.value.split(",")))}
        placeholder={(suggestions ?? []).join(", ")}
      />
      <p className="mt-1.5 text-xs text-zinc-500">{help}</p>
      {suggestions && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => {
            const active = values.includes(suggestion);
            return (
              <button
                key={suggestion}
                type="button"
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  active
                    ? "border-brand-500/40 bg-brand-500/10 text-brand-300"
                    : "border-surface-4 bg-surface-2 text-zinc-500 hover:text-zinc-300",
                )}
                onClick={() => {
                  if (active) {
                    onChange(values.filter((value) => value !== suggestion));
                  } else {
                    onChange(uniqueTokens([...values, suggestion]));
                  }
                }}
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

export default function ListingContractFields({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TokenField
          label="Auth Schemes"
          help="Explicit auth methods an agent can expect when calling this API."
          values={value.authSchemes}
          suggestions={AUTH_SCHEME_SUGGESTIONS}
          onChange={(next) => onChange("authSchemes", next)}
        />
        <TokenField
          label="Interaction Modes"
          help="How the API is invoked or consumed by an agent."
          values={value.interactionModes}
          suggestions={INTERACTION_MODE_SUGGESTIONS}
          onChange={(next) => onChange("interactionModes", next)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
            Risk Level
          </label>
          <select
            className="input-base w-full"
            value={value.riskLevel}
            onChange={(e) => onChange("riskLevel", e.target.value as ListingRiskLevel)}
          >
            {RISK_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-zinc-500">
            Declares the execution risk of this listing.
          </p>
        </div>

        <div>
          <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
            Side-Effect Level
          </label>
          <select
            className="input-base w-full"
            value={value.sideEffectLevel}
            onChange={(e) =>
              onChange("sideEffectLevel", e.target.value as ListingSideEffectLevel)
            }
          >
            {SIDE_EFFECT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-zinc-500">
            Tells agents whether calls are read-only, reversible, or irreversible.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex items-start gap-3 rounded-lg border border-surface-4 bg-surface-2 p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-brand-500"
            checked={value.humanApprovalRequired}
            onChange={(e) => onChange("humanApprovalRequired", e.target.checked)}
          />
          <div>
            <p className="text-sm font-medium text-zinc-200">Human Approval Required</p>
            <p className="mt-1 text-xs text-zinc-500">
              Require explicit human review before risky or side-effecting actions.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-surface-4 bg-surface-2 p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-brand-500"
            checked={value.noHealthProbe}
            onChange={(e) => onChange("noHealthProbe", e.target.checked)}
          />
          <div>
            <p className="text-sm font-medium text-zinc-200">No Health Probe</p>
            <p className="mt-1 text-xs text-zinc-500">
              Use this only if the API has no stable health endpoint and should not be probed.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
