import "dotenv/config";
import { getDb } from "../src/lib/db";
import {
  databaseSessionCleanupCutoff,
  deleteExpiredSessions,
} from "../src/lib/auth/session-cleanup";

export function assertNoCleanupArguments(args: string[]): void {
  if (args.length > 0) {
    throw new TypeError("Session cleanup does not accept arguments");
  }
}

async function main() {
  assertNoCleanupArguments(process.argv.slice(2));
  const startedAt = Date.now();
  const db = getDb();
  try {
    const cutoff = await databaseSessionCleanupCutoff(db);
    const deletedCount = await deleteExpiredSessions(db, cutoff);
    console.log(JSON.stringify({
      event: "auth_session_cleanup",
      cutoff: cutoff.toISOString(),
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
      event: "auth_session_cleanup_failed",
      message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    }));
    process.exitCode = 1;
  });
}
