import "dotenv/config";
import { getDb } from "../src/lib/db";
import { materializeDiscoverySnapshots } from "../src/lib/discover/materializer";
import { getDiscoveryMaterializerBatchTiming } from "../src/lib/discover/materializer-timing";

const DEFAULT_LIMIT = 100;

export function parseDiscoveryMaterializerArguments(args: string[]): number {
  if (args.length === 0) return DEFAULT_LIMIT;
  if (args.length !== 1 || !args[0]?.startsWith("--limit=")) {
    throw new TypeError("Discovery materializer accepts only one --limit=<positive safe integer> argument");
  }

  const value = args[0].slice("--limit=".length);
  if (!/^\d+$/.test(value)) {
    throw new RangeError("Discovery materializer limit must be a positive safe integer");
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Discovery materializer limit must be a positive safe integer");
  }

  return limit;
}

async function main() {
  const limit = parseDiscoveryMaterializerArguments(process.argv.slice(2));
  const timing = getDiscoveryMaterializerBatchTiming();
  const startedAt = Date.now();
  const db = getDb();
  try {
    const result = await materializeDiscoverySnapshots(limit, db, {
      batchTiming: timing,
    });
    console.log(JSON.stringify({
      event: "discovery_materialized",
      limit,
      ...result,
      elapsedMs: Date.now() - startedAt,
    }));
  } finally {
    await db.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "discovery_materialization_failed",
      message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    }));
    process.exitCode = 1;
  });
}
