import "dotenv/config";
import { getDb } from "../src/lib/db";
import {
  databaseDiscoverySnapshotCleanupCutoff,
  deleteExpiredDiscoverySnapshots,
} from "../src/lib/discover/snapshot-cleanup";

const DEFAULT_LIMIT = 100;

export function parseDiscoverySnapshotCleanupArguments(args: string[]): number {
  if (args.length === 0) return DEFAULT_LIMIT;
  if (args.length !== 1 || !args[0]?.startsWith("--limit=")) {
    throw new TypeError("Discovery snapshot cleanup accepts only one --limit=<positive safe integer> argument");
  }

  const value = args[0].slice("--limit=".length);
  if (!/^\d+$/.test(value)) {
    throw new RangeError("Discovery snapshot cleanup limit must be a positive safe integer");
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Discovery snapshot cleanup limit must be a positive safe integer");
  }
  return limit;
}

async function main() {
  const limit = parseDiscoverySnapshotCleanupArguments(process.argv.slice(2));
  const startedAt = Date.now();
  const db = getDb();
  try {
    const cutoff = await databaseDiscoverySnapshotCleanupCutoff(db);
    const deletedCount = await deleteExpiredDiscoverySnapshots(db, cutoff, limit);
    console.log(JSON.stringify({
      event: "discovery_snapshot_cleanup",
      cutoff: cutoff.toISOString(),
      limit,
      deletedCount,
      elapsedMs: Date.now() - startedAt,
    }));
  } finally {
    await db.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "discovery_snapshot_cleanup_failed",
      message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    }));
    process.exitCode = 1;
  });
}
