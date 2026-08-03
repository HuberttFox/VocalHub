import "dotenv/config";
import { getDb } from "../src/lib/db";
import { isUuid } from "../src/lib/catalog/id";
import { disposePlaylistReport, listOpenPlaylistReports, setPlaylistModerationStatus } from "../src/lib/playlists/repository";
import { REPORT_QUEUE_DEFAULT_LIMIT, REPORT_QUEUE_MAX_LIMIT, REPORT_RESOLUTION_CODE_PATTERN } from "../src/lib/playlists/query";

const ACTIONS = new Set(["hide", "restore"]);
type ModerationArguments =
  | { action: "hide" | "restore"; playlistId: string }
  | { action: "list-reports"; limit: number }
  | { action: "resolve-report" | "dismiss-report"; reportId: string; resolutionCode: string };

export function parseModerationArguments(args: string[]): ModerationArguments {
  if (args.length === 2 && ACTIONS.has(args[0]) && isUuid(args[1])) return { action: args[0] as "hide" | "restore", playlistId: args[1] };
  if (args[0] === "list-reports") {
    if (args.length === 1) return { action: "list-reports", limit: REPORT_QUEUE_DEFAULT_LIMIT };
    if (args.length === 2 && args[1].startsWith("--limit=")) {
      const limit = Number(args[1].slice("--limit=".length));
      if (Number.isInteger(limit) && limit >= 1 && limit <= REPORT_QUEUE_MAX_LIMIT) return { action: "list-reports", limit };
    }
  }
  if ((args[0] === "resolve-report" || args[0] === "dismiss-report") && args.length === 3 && isUuid(args[1]) && args[2] === args[2].trim() && REPORT_RESOLUTION_CODE_PATTERN.test(args[2])) {
    return { action: args[0], reportId: args[1], resolutionCode: args[2] };
  }
  throw new TypeError("Usage: moderate-playlist <hide|restore> <playlist-uuid> | list-reports [--limit=N] | <resolve-report|dismiss-report> <report-uuid> <resolution-code>");
}

async function main() {
  const parsed = parseModerationArguments(process.argv.slice(2));
  const db = getDb();
  try {
    if (parsed.action === "list-reports") {
      console.log(JSON.stringify({ event: "playlist_report_queue", limit: parsed.limit, reports: await listOpenPlaylistReports(parsed.limit) }));
      return;
    }
    if (parsed.action === "hide" || parsed.action === "restore") {
      const status = await setPlaylistModerationStatus(parsed.playlistId, parsed.action === "hide" ? "HIDDEN" : "ACTIVE", parsed.action === "hide" ? "HIDDEN" : "NO_ACTION");
      if (status === "NOT_FOUND") process.exitCode = 1;
      console.log(JSON.stringify({ event: "playlist_moderation", action: parsed.action, playlistId: parsed.playlistId, status }));
      return;
    }
    if (parsed.action !== "resolve-report" && parsed.action !== "dismiss-report") throw new Error("Unsupported moderation action");
    const result = await disposePlaylistReport(parsed.reportId, parsed.action === "resolve-report" ? "RESOLVED" : "DISMISSED", parsed.resolutionCode);
    if (result === "NOT_FOUND") process.exitCode = 1;
    console.log(JSON.stringify({ event: "playlist_report_disposition", action: parsed.action, report: result }));
  } finally {
    await db.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "playlist_moderation_failed", message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" }));
    process.exitCode = 1;
  });
}
