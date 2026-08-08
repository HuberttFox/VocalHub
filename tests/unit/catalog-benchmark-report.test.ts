import { describe, expect, it } from "vitest";
import {
  printReport,
  redactReport,
  type BenchmarkReport,
} from "../../benchmarks/catalog/report";

function report(): BenchmarkReport {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-22T00:00:00.000Z",
    command: "compare-search-shape",
    dataset: { songCount: 20_000 },
    environment: {
      database: "postgresql://user:secret@localhost:5434/vocalhub_benchmark",
      node: "v26",
      platform: "linux",
    },
    runs: [],
    pairedComparison: {
      kind: "search-shape",
      candidate: "relation-branch-union",
      scenarios: [{
        name: "songs-search-rare-title",
        warmups: 3,
        repeats: 2,
        pairs: [
          { pairIndex: 0, order: "AB", aDurationMs: 100, bDurationMs: 20, bChangePercent: -80 },
          { pairIndex: 1, order: "BA", aDurationMs: 90, bDurationMs: 18, bChangePercent: -80 },
        ],
        summary: {
          a: { minMs: 90, medianMs: 90, p95Ms: 100, maxMs: 100, meanMs: 95 },
          b: { minMs: 18, medianMs: 18, p95Ms: 20, maxMs: 20, meanMs: 19 },
          medianPairedChangePercent: -80,
          bWinCount: 2,
          bWinRate: 1,
          bFirstMedianPairedChangePercent: -80,
          bSecondMedianPairedChangePercent: -80,
        },
        resultDigest: "digest",
        aQueries: [],
        bQueries: [],
        aExplains: [],
        bExplains: [],
      }],
    },
  };
}

describe("catalog benchmark paired report", () => {
  it("redacts database credentials without dropping paired evidence", () => {
    const safe = redactReport(report());
    expect(safe.environment.database).not.toContain("user");
    expect(safe.environment.database).not.toContain("secret");
    expect(safe.pairedComparison?.scenarios[0].pairs).toHaveLength(2);
  });

  it("prints paired summaries", () => {
    const original = console.table;
    const tables: unknown[] = [];
    console.table = (value?: unknown) => { tables.push(value); };
    try {
      printReport(report());
    } finally {
      console.table = original;
    }
    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual([
      expect.objectContaining({
        scenario: "songs-search-rare-title",
        pairedChangePercent: -80,
        bWinRate: 1,
      }),
    ]);
  });

  it("handles the discovery-shape paired kind", () => {
    const discoveryReport: BenchmarkReport = {
      ...report(),
      command: "compare-discovery-shape",
      pairedComparison: {
        kind: "discovery-shape",
        candidate: "combined-cte",
        scenarios: [{
          ...report().pairedComparison!.scenarios[0],
          name: "discover-personalized-first-page",
        }],
      },
    };
    const original = console.table;
    const tables: unknown[] = [];
    console.table = (value?: unknown) => { tables.push(value); };
    try {
      printReport(discoveryReport);
    } finally {
      console.table = original;
    }
    expect(redactReport(discoveryReport).pairedComparison?.kind).toBe("discovery-shape");
    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual([
      expect.objectContaining({ scenario: "discover-personalized-first-page" }),
    ]);
  });
});
