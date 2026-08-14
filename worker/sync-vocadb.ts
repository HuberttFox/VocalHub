import "dotenv/config";
import pg from "pg";
import { SyncRunMode } from "../src/generated/prisma/enums";
import { getDb } from "../src/lib/db";
import { materializeDiscoverySnapshots } from "../src/lib/discover/materializer";
import { getDiscoveryMaterializerBatchTiming } from "../src/lib/discover/materializer-timing";
import { VocaDbClient } from "../src/lib/vocadb/client";
import { runVocaDbArtistSync } from "../src/lib/vocadb/artist-sync-runner";
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
  const parsedRequest = parseSyncArgs(process.argv.slice(2));
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
  const db = getDb();
  let lockHeld = false;
  let materializeDiscovery = false;
  try {
    await lockClient.connect();
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another VocaDB sync worker holds the advisory lock");
    }
    lockHeld = true;
    if (shutdown.signal.aborted) throw new VocaDbCancellationError();

    const client = new VocaDbClient({
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
      timeoutMs: config.timeoutMs,
    });
    const common = {
      db,
      client,
      concurrency: config.concurrency,
      signal: shutdown.signal,
    };
    const result = "entity" in parsedRequest
      ? await runVocaDbArtistSync(toArtistRunnerRequest(parsedRequest), {
          ...common,
          refreshIntervalMs: config.artistRefreshIntervalMs,
        })
      : await runVocaDbSongSync(toRunnerRequest(parsedRequest), {
          ...common,
          activityOverlapMs: config.activityOverlapMs,
          settlementLagMs: config.settlementLagMs,
          materializeDiscovery: false,
        });

    console.log(
      `Sync run ${result.runId}: ${result.status} (${result.successCount} succeeded, ${result.failureCount} failed)`,
    );
    if (result.failureCount > 0) process.exitCode = 1;
    materializeDiscovery = !('entity' in parsedRequest)
      && result.catalogChanged === true
      && result.status !== "FAILED";

    await lockClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    lockHeld = false;
    if (materializeDiscovery) {
      try {
        await materializeDiscoverySnapshots(100, db, {
          batchTiming: getDiscoveryMaterializerBatchTiming(),
        });
      } catch (error) {
        console.error(
          `Discovery materialization failed after song sync: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } catch (error) {
    if (isVocaDbCancellation(error, shutdown.signal)) {
      process.exitCode = shutdownExitCode ?? 1;
      return;
    }
    throw error;
  } finally {
    await db.$disconnect();
    if (lockHeld) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    }
    await lockClient.end().catch(() => undefined);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

function toRunnerRequest(
  request: Exclude<ReturnType<typeof parseSyncArgs>, { entity: "ARTIST" }>,
): SyncRunRequest {
  if (request.mode === "RESUME") return { mode: "RESUME" };
  if (request.mode === "AUTO") {
    return { mode: "AUTO", target: request.target };
  }
  if (request.mode === SyncRunMode.IDS) {
    return { mode: SyncRunMode.IDS, ids: request.ids };
  }
  return { mode: request.mode };
}

function toArtistRunnerRequest(
  request: Extract<ReturnType<typeof parseSyncArgs>, { entity: "ARTIST" }>,
) {
  if (request.mode === "IDS") return { mode: SyncRunMode.IDS, ids: request.ids } as const;
  if (request.mode === "AUTO") return { mode: "AUTO", target: SyncRunMode.REFRESH } as const;
  if (request.mode === "RESUME") return { mode: "RESUME" } as const;
  return { mode: SyncRunMode.REFRESH } as const;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "VocaDB sync failed");
  process.exitCode = 1;
});
