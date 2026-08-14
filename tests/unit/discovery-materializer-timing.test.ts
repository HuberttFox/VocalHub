import { describe, expect, it } from "vitest";
import {
  getDiscoveryMaterializerBatchTiming,
  getDiscoveryMaterializerTiming,
} from "@/lib/discover/materializer-timing";

describe("discovery materializer timing", () => {
  it("uses coordinated default transaction, statement, and lease limits", () => {
    expect(getDiscoveryMaterializerTiming({})).toEqual({
      buildTimeoutMs: 300_000,
      statementTimeoutMs: 290_000,
      buildLeaseMs: 420_000,
    });
  });

  it("derives bounded timing from configured build timeout", () => {
    expect(getDiscoveryMaterializerTiming({
      DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS: "600000",
    })).toEqual({
      buildTimeoutMs: 600_000,
      statementTimeoutMs: 590_000,
      buildLeaseMs: 720_000,
    });
  });

  it("uses a 24-minute maintenance batch budget with one-attempt reservation", () => {
    expect(getDiscoveryMaterializerBatchTiming({})).toEqual({
      buildTimeoutMs: 300_000,
      statementTimeoutMs: 290_000,
      buildLeaseMs: 420_000,
      batchBudgetMs: 1_440_000,
      attemptReservationMs: 420_000,
    });
  });

  it("derives batch reservation from configured build timeout", () => {
    expect(getDiscoveryMaterializerBatchTiming({
      DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS: "600000",
      DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS: "720000",
    })).toMatchObject({
      buildTimeoutMs: 600_000,
      batchBudgetMs: 720_000,
      attemptReservationMs: 720_000,
    });
  });

  it("rejects malformed and out-of-range build timeouts", () => {
    for (const value of ["0", "29999", "1200001", "1.5", "five minutes"]) {
      expect(() => getDiscoveryMaterializerTiming({
        DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS: value,
      })).toThrow("DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS");
    }
  });

  it("rejects malformed, oversized, and under-reserved batch budgets", () => {
    for (const value of ["0", "1440001", "1.5", "twenty minutes"]) {
      expect(() => getDiscoveryMaterializerBatchTiming({
        DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS: value,
      })).toThrow("DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS");
    }
    expect(() => getDiscoveryMaterializerBatchTiming({
      DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS: "600000",
      DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS: "719999",
    })).toThrow("DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS");
  });
});
