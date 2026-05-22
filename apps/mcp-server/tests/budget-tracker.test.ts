import { describe, expect, it } from "vitest";
import { BudgetTracker } from "../src/services/budget-tracker";

describe("BudgetTracker quote policy", () => {
  it("allows valid quotes inside all configured limits", () => {
    const budget = new BudgetTracker(1, {
      maxPricePerCallUsdc: 0.25,
      maxSlippagePct: 20,
    });

    expect(
      budget.checkQuote({
        quotePriceUsdc: 0.12,
        expectedPriceUsdc: 0.1,
        maxQuoteUsdc: 0.2,
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects malformed quotes before signing", () => {
    const budget = new BudgetTracker(1);

    const result = budget.checkQuote({ quotePriceUsdc: Number.NaN });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("malformed");
  });

  it("rejects quotes above the task or call limit", () => {
    const budget = new BudgetTracker(1);

    const result = budget.checkQuote({
      quotePriceUsdc: 0.11,
      maxQuoteUsdc: 0.1,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task/call limit");
  });

  it("rejects quotes above the global per-call cap", () => {
    const budget = new BudgetTracker(1, { maxPricePerCallUsdc: 0.05 });

    const result = budget.checkQuote({ quotePriceUsdc: 0.051 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("max per-call limit");
  });

  it("rejects quotes that exceed remaining session budget", () => {
    const budget = new BudgetTracker(0.1);
    budget.recordSpend("search-api", 0.07);

    const result = budget.checkQuote({ quotePriceUsdc: 0.04 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("remaining session budget");
  });

  it("rejects quotes beyond configured slippage from expected price", () => {
    const budget = new BudgetTracker(1, { maxSlippagePct: 10 });

    const result = budget.checkQuote({
      quotePriceUsdc: 0.112,
      expectedPriceUsdc: 0.1,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("more than 10%");
  });

  it("uses 6-decimal USDC tolerance at the boundary", () => {
    const budget = new BudgetTracker(1, { maxPricePerCallUsdc: 0.1 });

    const result = budget.checkQuote({ quotePriceUsdc: 0.1000004 });

    expect(result.allowed).toBe(true);
  });
});
