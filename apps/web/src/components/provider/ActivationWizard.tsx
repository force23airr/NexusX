"use client";

import { useState, useCallback } from "react";
import { provider } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ListingDetail } from "@/types";

interface Props {
  listing: ListingDetail;
  onActivated: () => void;
  onClose: () => void;
}

type StepStatus = "pending" | "running" | "pass" | "fail";

interface StepState {
  status: StepStatus;
  message: string;
  detail?: string;
}

export function ActivationWizard({ listing, onActivated, onClose }: Props) {
  const [steps, setSteps] = useState<[StepState, StepState, StepState]>([
    { status: "pending", message: "Validate configuration" },
    { status: "pending", message: "Health check" },
    { status: "pending", message: "Sandbox test" },
  ]);
  const [isActivating, setIsActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const updateStep = useCallback(
    (index: 0 | 1 | 2, update: Partial<StepState>) => {
      setSteps((prev) => {
        const next = [...prev] as [StepState, StepState, StepState];
        next[index] = { ...next[index], ...update };
        return next;
      });
    },
    []
  );

  // ─── Step 1: Validate config ───
  const runValidation = useCallback(() => {
    updateStep(0, { status: "running", message: "Validating configuration..." });

    const issues: string[] = [];
    if (!listing.baseUrl) issues.push("Base URL is required");
    if (!listing.floorPriceUsdc || listing.floorPriceUsdc <= 0)
      issues.push("Floor price must be > 0");
    if (!listing.categorySlug) issues.push("Category is required");
    if (!listing.description) issues.push("Description is required");

    if (issues.length > 0) {
      updateStep(0, {
        status: "fail",
        message: "Configuration issues found",
        detail: issues.join(". "),
      });
      return false;
    }

    updateStep(0, {
      status: "pass",
      message: "Configuration valid",
      detail: `Base URL: ${listing.baseUrl}`,
    });
    return true;
  }, [listing, updateStep]);

  // ─── Step 2: Health check ───
  const runHealthCheck = useCallback(async () => {
    updateStep(1, { status: "running", message: "Checking health endpoint..." });

    try {
      const result = await provider.healthCheck(listing.id);

      if (result.ok) {
        updateStep(1, {
          status: "pass",
          message: `Health check passed (${result.latencyMs}ms)`,
          detail: `Status: ${result.statusCode}`,
        });
        return true;
      } else {
        updateStep(1, {
          status: "fail",
          message: "Health check failed",
          detail: result.error || `Status: ${result.statusCode}`,
        });
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      updateStep(1, {
        status: "fail",
        message: "Health check error",
        detail: message,
      });
      return false;
    }
  }, [listing.id, updateStep]);

  // ─── Step 3: Sandbox test ───
  const runSandboxTest = useCallback(async () => {
    updateStep(2, { status: "running", message: "Running sandbox test..." });

    try {
      const result = await provider.testCall(listing.id);

      if (result.ok) {
        updateStep(2, {
          status: "pass",
          message: `Sandbox test passed (${result.latencyMs}ms)`,
          detail:
            result.responsePreview.length > 100
              ? result.responsePreview.slice(0, 100) + "..."
              : result.responsePreview,
        });
        return true;
      } else {
        updateStep(2, {
          status: "fail",
          message: "Sandbox test failed",
          detail: result.error || `Status: ${result.statusCode}`,
        });
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      updateStep(2, {
        status: "fail",
        message: "Sandbox test error",
        detail: message,
      });
      return false;
    }
  }, [listing.id, updateStep]);

  // ─── Run All Steps ───
  const runAllSteps = useCallback(async () => {
    // Reset
    setSteps([
      { status: "pending", message: "Validate configuration" },
      { status: "pending", message: "Health check" },
      { status: "pending", message: "Sandbox test" },
    ]);

    // Step 1
    const valid = runValidation();
    if (!valid) return;

    // Step 2
    const healthy = await runHealthCheck();
    if (!healthy) return;

    // Step 3
    await runSandboxTest();
  }, [runValidation, runHealthCheck, runSandboxTest]);

  // ─── Activate ───
  const handleActivate = useCallback(async () => {
    setIsActivating(true);
    setActivateError(null);
    try {
      await provider.setStatus(listing.id, "activate");
      onActivated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Activation failed";
      setActivateError(message);
    } finally {
      setIsActivating(false);
    }
  }, [listing.id, onActivated]);

  const allPassed = steps.every((s) => s.status === "pass");
  const anyRunning = steps.some((s) => s.status === "running");
  const hasStarted = steps[0].status !== "pending";

  return (
    <div className="card p-6 space-y-6 border-brand-600/20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            Activate Listing
          </h3>
          <p className="text-sm text-zinc-400 mt-1">
            Complete these checks to go live on the marketplace.
          </p>
        </div>
        <button onClick={onClose} className="btn-ghost text-zinc-400 hover:text-zinc-200">
          &times;
        </button>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border",
              step.status === "pass" && "border-emerald-600/30 bg-emerald-500/5",
              step.status === "fail" && "border-red-600/30 bg-red-500/5",
              step.status === "running" && "border-brand-600/30 bg-brand-500/5",
              step.status === "pending" && "border-surface-4 bg-surface-2"
            )}
          >
            {/* Icon */}
            <div className="mt-0.5 text-lg w-6 text-center shrink-0">
              {step.status === "pending" && <span className="text-zinc-500">○</span>}
              {step.status === "running" && (
                <span className="text-brand-400 animate-pulse">◌</span>
              )}
              {step.status === "pass" && <span className="text-emerald-400">&#10003;</span>}
              {step.status === "fail" && <span className="text-red-400">&#10007;</span>}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">
                Step {i + 1}: {step.message}
              </p>
              {step.detail && (
                <p className="text-xs text-zinc-400 mt-0.5 truncate">
                  {step.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      {activateError && (
        <div className="text-sm text-red-400 bg-red-500/5 border border-red-600/30 rounded-lg p-3">
          {activateError}
        </div>
      )}

      <div className="flex items-center gap-3">
        {!hasStarted && (
          <button onClick={runAllSteps} className="btn-primary">
            Run Checks
          </button>
        )}

        {hasStarted && !allPassed && !anyRunning && (
          <button onClick={runAllSteps} className="btn-primary">
            Retry Checks
          </button>
        )}

        {allPassed && (
          <button
            onClick={handleActivate}
            disabled={isActivating}
            className={cn(
              "btn-primary bg-emerald-600 hover:bg-emerald-500",
              isActivating && "opacity-60 cursor-not-allowed"
            )}
          >
            {isActivating ? "Activating..." : "Activate Listing"}
          </button>
        )}

        <button onClick={onClose} className="btn-ghost text-zinc-400">
          Cancel
        </button>
      </div>
    </div>
  );
}
