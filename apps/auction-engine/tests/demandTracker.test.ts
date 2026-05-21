// ═══════════════════════════════════════════════════════════════
// NexusX — Demand Tracker Tests
// apps/auction-engine/tests/demandTracker.test.ts
// ═══════════════════════════════════════════════════════════════

import { DemandTracker, resetDemandTracker, getDemandTracker } from "../src/services/demandTracker";
import { DemandSignalType } from "@nexusx/types";
import type { DemandSignal } from "@nexusx/types";

/** Build a demand signal of a given type for a listing. */
const signal = (listingId: string, type: DemandSignalType): DemandSignal => ({
  listingId,
  timestamp: Date.now(),
  type,
  weight: 1,
});

describe("DemandTracker", () => {
  let tracker: DemandTracker;

  beforeEach(() => {
    resetDemandTracker();
    tracker = new DemandTracker();
  });

  describe("empty state", () => {
    it("reports a zero demand score for an untracked listing", () => {
      const state = tracker.computeDemandState("unknown-listing");
      expect(state.score).toBe(0);
      expect(state.velocity).toBe(0);
      expect(state.uniqueBuyers).toBe(0);
    });

    it("returns null for getLastState before any compute", () => {
      expect(tracker.getLastState("unknown-listing")).toBeNull();
    });
  });

  describe("signal ingestion", () => {
    it("raises the demand score as API calls accumulate", () => {
      const before = tracker.computeDemandState("listing-a").score;
      for (let i = 0; i < 50; i++) {
        tracker.ingestSignal(signal("listing-a", DemandSignalType.API_CALL));
      }
      const after = tracker.computeDemandState("listing-a").score;
      expect(after).toBeGreaterThan(before);
    });

    it("weights API calls more heavily than passive views", () => {
      for (let i = 0; i < 30; i++) {
        tracker.ingestSignal(signal("calls", DemandSignalType.API_CALL));
        tracker.ingestSignal(signal("views", DemandSignalType.VIEW));
      }
      const callScore = tracker.computeDemandState("calls").score;
      const viewScore = tracker.computeDemandState("views").score;
      expect(callScore).toBeGreaterThan(viewScore);
    });

    it("counts distinct buyers, not raw signal volume", () => {
      tracker.ingestSignal(signal("listing-b", DemandSignalType.API_CALL), "buyer-1");
      tracker.ingestSignal(signal("listing-b", DemandSignalType.API_CALL), "buyer-1");
      tracker.ingestSignal(signal("listing-b", DemandSignalType.API_CALL), "buyer-2");
      const state = tracker.computeDemandState("listing-b");
      expect(state.uniqueBuyers).toBe(2);
    });

    it("treats unsubscriptions as negative demand", () => {
      for (let i = 0; i < 10; i++) {
        tracker.ingestSignal(signal("listing-c", DemandSignalType.API_CALL));
      }
      const positive = tracker.computeDemandState("listing-c").rawSignalSum;
      tracker.ingestSignal(signal("listing-c", DemandSignalType.UNSUBSCRIPTION));
      const afterChurn = tracker.computeDemandState("listing-c").rawSignalSum;
      expect(afterChurn).toBeLessThan(positive);
    });

    it("ingests a batch of signals", () => {
      tracker.ingestBatch([
        { signal: signal("listing-d", DemandSignalType.API_CALL), buyerId: "b1" },
        { signal: signal("listing-d", DemandSignalType.API_CALL), buyerId: "b2" },
      ]);
      const state = tracker.computeDemandState("listing-d");
      expect(state.uniqueBuyers).toBe(2);
      expect(state.rawSignalSum).toBeGreaterThan(0);
    });
  });

  describe("score bounds", () => {
    it("clamps the demand score to a 0-100 range", () => {
      for (let i = 0; i < 5_000; i++) {
        tracker.ingestSignal(signal("hot-listing", DemandSignalType.API_CALL));
      }
      const state = tracker.computeDemandState("hot-listing");
      expect(state.score).toBeGreaterThanOrEqual(0);
      expect(state.score).toBeLessThanOrEqual(100);
    });
  });

  describe("velocity", () => {
    it("reports zero velocity without enough window history", () => {
      tracker.ingestSignal(signal("listing-e", DemandSignalType.API_CALL));
      expect(tracker.computeDemandState("listing-e").velocity).toBe(0);
    });
  });

  describe("lifecycle", () => {
    it("removes a listing's tracker on delist", () => {
      tracker.ingestSignal(signal("listing-f", DemandSignalType.API_CALL));
      tracker.computeDemandState("listing-f");
      tracker.removeListing("listing-f");
      expect(tracker.getLastState("listing-f")).toBeNull();
    });

    it("reports stats across all tracked listings", () => {
      tracker.ingestSignal(signal("l1", DemandSignalType.API_CALL), "buyer-x");
      tracker.ingestSignal(signal("l2", DemandSignalType.API_CALL), "buyer-y");
      const stats = tracker.getStats();
      expect(stats.trackedListings).toBe(2);
      expect(stats.totalSignalsInCurrentWindows).toBe(2);
      expect(stats.totalUniqueBuyers).toBe(2);
    });

    it("getDemandTracker returns a stable singleton", () => {
      resetDemandTracker();
      expect(getDemandTracker()).toBe(getDemandTracker());
    });
  });
});
