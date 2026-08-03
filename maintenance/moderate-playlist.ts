import "dotenv/config";
import { getDb } from "../src/lib/db";
import { isUuid } from "../src/lib/catalog/id";
import { setPlaylistModerationStatus } from "../src/lib/playlists/repository";

const ACTIONS = new Set(["hide", "restore"]);

export function parseModerationArguments(args: string[]): { action: "hide" | "restore"; playlistId: string } {
  if (args.length !== 2 || !ACTIONS.has(args[0]) || !isUuid(args[1])) {
    throw new TypeError("Usage: moderate-playlist <hide|restore> <playlist-uuid>");
  }
  return { action: args[0] as "hide" | "restore", playlistId: args[1] };
}

async function main() {
  const { action, playlistId } = parseModerationArguments(process.argv.slice(2));
  const db = getDb();
  try {
    const status = await setPlaylistModerationStatus(playlistId, action === "hide" ? "HIDDEN" : "ACTIVE", action === "hide" ? "HIDDEN" : "NO_ACTION");
    if (status === "NOT_FOUND") process.exitCode = 1;
    console.log(JSON.stringify({ event: "playlist_moderation", action, playlistId, status }));
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
