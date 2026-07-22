import "dotenv/config";
import pg from "pg";
import { SyncRunMode } from "../src/generated/prisma/enums";
import { getDb } from "../src/lib/db";
import { VocaDbClient } from "../src/lib/vocadb/client";
import {
  isVocaDbCancellation,
  VocaDbCancellationError,
} from "../src/lib/vocadb/errors";
import { parseSyncArgs } from "../src/lib/vocadb/sync-cli";
import {
  runVocaDbSongSync,
  type SyncRunRequest,
} from "../src/lib/vocadb/sync-runner";
import { parseVocaDbWorkerConfig } from "../src/lib/vocadb/worker-config";

const ADVISORY_LOCK_KEY = 8_621_427_941;

async function main() {
  const request = toRunnerRequest(parseSyncArgs(process.argv.slice(2)));
  const config = parseVocaDbWorkerConfig(process.env);
  process.env.DATABASE_URL = config.connectionString;
  const shutdown = new AbortController();
  let shutdownExitCode: number | undefined;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shutdown.signal.aborted) return;
    shutdownExitCode = signal === "SIGINT" ? 130 : 143;
    console.error(`${signal} received; stopping VocaDB sync gracefully`);
    shutdown.abort(new VocaDbCancellationError());
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  const lockClient = new pg.Client({ connectionString: config.connectionString });
  try {
    await lockClient.connect();
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another VocaDB sync worker holds the advisory lock");
    }
    if (shutdown.signal.aborted) throw new VocaDbCancellationError();

    const db = getDb();
    try {
      const result = await runVocaDbSongSync(request, {
        db,
        client: new VocaDbClient({
          baseUrl: config.baseUrl,
          userAgent: config.userAgent,
          timeoutMs: config.timeoutMs,
        }),
        activityOverlapMs: config.activityOverlapMs,
        settlementLagMs: config.settlementLagMs,
        concurrency: config.concurrency,
        signal: shutdown.signal,
      });

      console.log(
        `Sync run ${result.runId}: ${result.status} (${result.successCount} succeeded, ${result.failureCount} failed)`,
      );
      if (result.failureCount > 0) process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (isVocaDbCancellation(error, shutdown.signal)) {
      process.exitCode = shutdownExitCode ?? 1;
      return;
    }
    throw error;
  } finally {
    await lockClient.end().catch(() => undefined);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

function toRunnerRequest(request: ReturnType<typeof parseSyncArgs>): SyncRunRequest {
  if (request.mode === "RESUME") return { mode: "RESUME" };
  if (request.mode === "AUTO") {
    return { mode: "AUTO", target: request.target };
  }
  if (request.mode === SyncRunMode.IDS) {
    return { mode: SyncRunMode.IDS, ids: request.ids };
  }
  return { mode: request.mode };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "VocaDB sync failed");
  process.exitCode = 1;
});
