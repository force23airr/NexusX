"use client";

import { cn } from "@/lib/utils";
import type { ListingOperationContract, ListingOperationMethod } from "@/types";

const HTTP_METHODS: ListingOperationMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const OPERATION_MODES = ["sync", "async", "streaming", "batch", "webhook"];

interface Props {
  value: ListingOperationContract[];
  onChange: (next: ListingOperationContract[]) => void;
  onAdd: () => void;
}

export default function ListingOperationContractsFields({
  value,
  onChange,
  onAdd,
}: Props) {
  const updateOperation = (
    index: number,
    patch: Partial<ListingOperationContract>,
  ) => {
    const next = value.map((operation, currentIndex) =>
      currentIndex === index ? { ...operation, ...patch } : operation,
    );
    onChange(next);
  };

  const removeOperation = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-4">
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-4 bg-surface-2/60 p-4 text-sm text-zinc-500">
          No operation contracts yet. Add the actions agents can take against this API.
        </div>
      ) : (
        value.map((operation, index) => {
          const hasExamples =
            Boolean(operation.sampleInput) || Boolean(operation.sampleOutput);
          const hasSchemas =
            Boolean(operation.inputSchema) || Boolean(operation.outputSchema);

          return (
            <div
              key={`${operation.operationId}-${index}`}
              className="rounded-xl border border-surface-4 bg-surface-2 p-4 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    {operation.name || `Operation ${index + 1}`}
                  </p>
                  <p className="text-2xs text-zinc-500 mt-1">
                    Agents use these contracts to decide how to call your API safely.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeOperation(index)}
                  className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel label="Operation Name" />
                  <input
                    className="input-base w-full"
                    value={operation.name}
                    onChange={(e) =>
                      updateOperation(index, {
                        name: e.target.value,
                        operationId:
                          operation.operationId ||
                          e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                      })
                    }
                    placeholder="place_order"
                  />
                </div>
                <div>
                  <FieldLabel label="Operation ID" />
                  <input
                    className="input-base w-full"
                    value={operation.operationId}
                    onChange={(e) =>
                      updateOperation(index, {
                        operationId: e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                      })
                    }
                    placeholder="place_order"
                  />
                </div>
              </div>

              <div>
                <FieldLabel label="Description" />
                <textarea
                  className="input-base w-full min-h-[80px] resize-y"
                  value={operation.description}
                  onChange={(e) => updateOperation(index, { description: e.target.value })}
                  placeholder="Explain what this action does and when an agent should use it."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <FieldLabel label="Method" />
                  <select
                    className="input-base w-full"
                    value={operation.method}
                    onChange={(e) =>
                      updateOperation(index, {
                        method: e.target.value as ListingOperationMethod,
                        idempotent:
                          e.target.value === "GET" ||
                          e.target.value === "PUT" ||
                          e.target.value === "DELETE",
                        sideEffect: e.target.value !== "GET",
                      })
                    }
                  >
                    {HTTP_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <FieldLabel label="Path" />
                  <input
                    className="input-base w-full font-mono"
                    value={operation.path}
                    onChange={(e) => updateOperation(index, { path: e.target.value })}
                    placeholder="/orders"
                  />
                </div>
                <div>
                  <FieldLabel label="Mode" />
                  <select
                    className="input-base w-full"
                    value={operation.mode}
                    onChange={(e) => updateOperation(index, { mode: e.target.value })}
                  >
                    {OPERATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <FieldLabel label="Auth Scheme" />
                  <input
                    className="input-base w-full"
                    value={operation.authScheme ?? ""}
                    onChange={(e) =>
                      updateOperation(index, {
                        authScheme: e.target.value.trim().toLowerCase() || null,
                      })
                    }
                    placeholder="api_key"
                  />
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-surface-4 bg-surface-1 px-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-brand-500"
                    checked={operation.idempotent}
                    onChange={(e) =>
                      updateOperation(index, { idempotent: e.target.checked })
                    }
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Idempotent</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Safe to retry without duplicating the effect.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-surface-4 bg-surface-1 px-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-brand-500"
                    checked={operation.sideEffect}
                    onChange={(e) =>
                      updateOperation(index, { sideEffect: e.target.checked })
                    }
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Side Effects</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Indicates this action changes external state.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <StatusChip active={hasSchemas} label="Schema attached" />
                <StatusChip active={hasExamples} label="Examples attached" />
                <StatusChip
                  active={Boolean(operation.authScheme)}
                  label={operation.authScheme ? `Auth: ${operation.authScheme}` : "Auth inherited"}
                />
              </div>
            </div>
          );
        })
      )}

      <button
        type="button"
        onClick={onAdd}
        className="rounded-lg border border-brand-500/20 bg-brand-500/5 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/10"
      >
        Add Operation
      </button>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
      {label}
    </label>
  );
}

function StatusChip({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-1 text-xs",
        active
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
          : "border-surface-4 bg-surface-1 text-zinc-500",
      )}
    >
      {label}
    </span>
  );
}
