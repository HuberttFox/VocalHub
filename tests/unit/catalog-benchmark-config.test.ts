import { describe, expect, it } from "vitest";
import {
  assertBenchmarkDatabaseName,
  assertResetConfirmation,
  parseCatalogBenchmarkConfig,
  parseChunkSize,
} from "../../benchmarks/catalog/config";

const benchmarkUrl =
  "postgresql://benchmark-user:do-not-print@localhost:5434/vocalhub_benchmark";

describe("catalog benchmark configuration", () => {
  it("uses only the isolated benchmark URL and returns a redacted identity", () => {
    const config = parseCatalogBenchmarkConfig({
      BENCHMARK_DATABASE_URL: benchmarkUrl,
    });

    expect(config).toEqual({
      connectionString: benchmarkUrl,
      databaseName: "vocalhub_benchmark",
      databaseIdentity: "postgresql://localhost:5434/vocalhub_benchmark",
    });
    expect(config.databaseIdentity).not.toContain("benchmark-user");
    expect(config.databaseIdentity).not.toContain("do-not-print");
  });

  it.each([
    [{}, "BENCHMARK_DATABASE_URL"],
    [{ BENCHMARK_DATABASE_URL: "not-a-url-do-not-print" }, "BENCHMARK_DATABASE_URL"],
    [{ BENCHMARK_DATABASE_URL: "mysql://localhost/vocalhub_benchmark" }, "PostgreSQL"],
    [{ BENCHMARK_DATABASE_URL: "postgresql://localhost/vocalhub" }, "_benchmark"],
    [{ BENCHMARK_DATABASE_URL: "postgresql://localhost/" }, "one database"],
  ] as const)("rejects unsafe configuration", (environment, message) => {
    expect(() => parseCatalogBenchmarkConfig(environment)).toThrow(message);
  });

  it("never includes credentials in validation errors", () => {
    const secret = "do-not-print";
    let message = "";
    try {
      parseCatalogBenchmarkConfig({
        BENCHMARK_DATABASE_URL: `postgresql://user:${secret}@localhost/production`,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("_benchmark");
    expect(message).not.toContain(secret);
  });

  it.each(["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"] as const)(
    "rejects a logical database alias through %s",
    (name) => {
      expect(() =>
        parseCatalogBenchmarkConfig({
          BENCHMARK_DATABASE_URL: benchmarkUrl,
          [name]: "postgres://other:secret@LOCALHOST:5434/vocalhub_benchmark?schema=public",
        }),
      ).toThrow(name);
    },
  );

  it("requires exact, case-sensitive reset confirmation", () => {
    expect(() =>
      assertResetConfirmation("vocalhub_benchmark", "vocalhub_benchmark"),
    ).not.toThrow();
    expect(() =>
      assertResetConfirmation("vocalhub_benchmark", "VOCALHUB_BENCHMARK"),
    ).toThrow("--confirm-reset=vocalhub_benchmark");
    expect(() =>
      assertResetConfirmation("vocalhub_benchmark", undefined),
    ).toThrow("--confirm-reset=vocalhub_benchmark");
  });

  it("checks the server-reported name with the same suffix rule", () => {
    expect(() => assertBenchmarkDatabaseName("catalog_benchmark")).not.toThrow();
    expect(() => assertBenchmarkDatabaseName("catalog_test")).toThrow("_benchmark");
  });

  it("validates bounded chunk sizes", () => {
    expect(parseChunkSize(undefined)).toBe(1_000);
    expect(parseChunkSize("250")).toBe(250);
    expect(() => parseChunkSize("0")).toThrow("chunk size");
    expect(() => parseChunkSize("1.5")).toThrow("chunk size");
    expect(() => parseChunkSize(5_001)).toThrow("chunk size");
  });
});
