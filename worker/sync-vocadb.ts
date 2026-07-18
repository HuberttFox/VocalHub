import "dotenv/config";
import pg from "pg";
import { SyncRunMode } from "../src/generated/prisma/enums";
import { getDb } from "../src/lib/db";
import { VocaDbClient } from "../src/lib/vocadb/client";
import { parseSyncArgs } from "../src/lib/vocadb/sync-cli";
import {
  DEFAULT_ACTIVITY_OVERLAP_MS,
  DEFAULT_SETTLEMENT_LAG_MS,
  runVocaDbSongSync,
  type SyncRunRequest,
} from "../src/lib/vocadb/sync-runner";

const ADVISORY_LOCK_KEY = 8_621_427_941;

async function main() {
  const request = toRunnerRequest(parseSyncArgs(process.argv.slice(2)));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const lockClient = new pg.Client({ connectionString });
  await lockClient.connect();
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another VocaDB sync worker holds the advisory lock");
    }

    const db = getDb();
    try {
      const result = await runVocaDbSongSync(request, {
        db,
        client: new VocaDbClient({
          baseUrl: process.env.VOCADB_BASE_URL,
          userAgent: process.env.VOCADB_USER_AGENT,
          timeoutMs: parseOptionalNumber(
            process.env.VOCADB_TIMEOUT_MS,
            "VOCADB_TIMEOUT_MS",
          ),
        }),
        activityOverlapMs: parseOptionalNumber(
          process.env.VOCADB_ACTIVITY_OVERLAP_MS,
          "VOCADB_ACTIVITY_OVERLAP_MS",
        ) ?? DEFAULT_ACTIVITY_OVERLAP_MS,
        settlementLagMs: parseOptionalNumber(
          process.env.VOCADB_SETTLEMENT_LAG_MS,
          "VOCADB_SETTLEMENT_LAG_MS",
        ) ?? DEFAULT_SETTLEMENT_LAG_MS,
      });

      console.log(
        `Sync run ${result.runId}: ${result.status} (${result.successCount} succeeded, ${result.failureCount} failed)`,
      );
      if (result.failureCount > 0) process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  } finally {
    await lockClient.end();
  }
}

function toRunnerRequest(request: ReturnType<typeof parseSyncArgs>): SyncRunRequest {
  if (request.mode === "RESUME") return { mode: "RESUME" };
  if (request.mode === SyncRunMode.IDS) {
    return { mode: SyncRunMode.IDS, ids: request.ids };
  }
  return { mode: request.mode };
}

function parseOptionalNumber(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "VocaDB sync failed");
  process.exitCode = 1;
});
