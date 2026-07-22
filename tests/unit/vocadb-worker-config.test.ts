import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVITY_OVERLAP_MS,
  DEFAULT_SETTLEMENT_LAG_MS,
  DEFAULT_SYNC_CONCURRENCY,
} from "@/lib/vocadb/sync-runner";
import { VOCADB_TIMEOUT_MS } from "@/lib/vocadb/client";
import { parseVocaDbWorkerConfig } from "@/lib/vocadb/worker-config";

const databaseUrl = "postgresql://user:secret@localhost:5432/vocalhub";

describe("VocaDB worker configuration", () => {
  it("parses defaults without exposing credentials", () => {
    expect(parseVocaDbWorkerConfig({ DATABASE_URL: databaseUrl })).toMatchObject({
      connectionString: databaseUrl,
      baseUrl: "https://vocadb.net",
      timeoutMs: VOCADB_TIMEOUT_MS,
      activityOverlapMs: DEFAULT_ACTIVITY_OVERLAP_MS,
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
      concurrency: DEFAULT_SYNC_CONCURRENCY,
    });
  });

  it("parses explicit integer settings", () => {
    expect(
      parseVocaDbWorkerConfig({
        DATABASE_URL: databaseUrl,
        VOCADB_TIMEOUT_MS: "5000",
        VOCADB_ACTIVITY_OVERLAP_MS: "0",
        VOCADB_SETTLEMENT_LAG_MS: "30000",
        VOCADB_SYNC_CONCURRENCY: "4",
      }),
    ).toMatchObject({
      timeoutMs: 5000,
      activityOverlapMs: 0,
      settlementLagMs: 30000,
      concurrency: 4,
    });
  });

  it.each([
    [{}, "DATABASE_URL"],
    [{ DATABASE_URL: "mysql://localhost/db" }, "DATABASE_URL"],
    [{ DATABASE_URL: databaseUrl, VOCADB_BASE_URL: "file:///tmp/api" }, "VOCADB_BASE_URL"],
    [{ DATABASE_URL: databaseUrl, VOCADB_TIMEOUT_MS: "0" }, "VOCADB_TIMEOUT_MS"],
    [{ DATABASE_URL: databaseUrl, VOCADB_TIMEOUT_MS: "2147483648" }, "VOCADB_TIMEOUT_MS"],
    [{ DATABASE_URL: databaseUrl, VOCADB_ACTIVITY_OVERLAP_MS: "-1" }, "VOCADB_ACTIVITY_OVERLAP_MS"],
    [{ DATABASE_URL: databaseUrl, VOCADB_SETTLEMENT_LAG_MS: "1.5" }, "VOCADB_SETTLEMENT_LAG_MS"],
    [{ DATABASE_URL: databaseUrl, VOCADB_SYNC_CONCURRENCY: "33" }, "VOCADB_SYNC_CONCURRENCY"],
  ] as const)("rejects invalid environment settings", (environment, name) => {
    expect(() => parseVocaDbWorkerConfig(environment)).toThrow(name);
  });

  it("requires HTTPS and an explicit user-agent in production", () => {
    expect(() =>
      parseVocaDbWorkerConfig({
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        VOCADB_BASE_URL: "http://vocadb.test/api",
        VOCADB_USER_AGENT: "VocalHub/1.0",
      }),
    ).toThrow("VOCADB_BASE_URL");

    expect(() =>
      parseVocaDbWorkerConfig({
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow("VOCADB_USER_AGENT");
  });

  it("does not include database credentials in validation errors", () => {
    const secret = "do-not-print";
    let message = "";
    try {
      parseVocaDbWorkerConfig({ DATABASE_URL: `not-a-url-${secret}` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain(secret);
  });
});
