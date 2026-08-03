import "dotenv/config";
import { getDb } from "../src/lib/db";

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export function reportRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - RETENTION_MS);
}

export function assertNoReportCleanupArguments(args: string[]): void {
  if (args.length > 0) throw new TypeError("Playlist report cleanup does not accept arguments");
}

async function main() {
  assertNoReportCleanupArguments(process.argv.slice(2));
  const db = getDb();
  const cutoff = reportRetentionCutoff();
  try {
    const deletedCount = (await db.playlistReport.deleteMany({
      where: { status: { in: ["RESOLVED", "DISMISSED"] }, resolvedAt: { lt: cutoff } },
    })).count;
    console.log(JSON.stringify({ event: "playlist_report_cleanup", cutoff: cutoff.toISOString(), deletedCount }));
  } finally {
    await db.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "playlist_report_cleanup_failed", message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" }));
    process.exitCode = 1;
  });
}
