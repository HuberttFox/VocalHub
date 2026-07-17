import "dotenv/config";
import { getDb } from "../src/lib/db";
import { SyncRunStatus, SyncStatus } from "../src/generated/prisma/enums";
import { VocaDbClient } from "../src/lib/vocadb/client";
import { VocaDbError } from "../src/lib/vocadb/errors";
import { normalizeVocaDbSong } from "../src/lib/vocadb/normalize";
import {
  markSongSyncFailure,
  syncVocaDbSong,
} from "../src/lib/vocadb/sync-song";

const DEFAULT_SONG_IDS = [121, 1477, 4904, 25430];
const CONCURRENCY = 2;

function parseSongIds(args: string[]): number[] {
  const idsArgument = args.find((argument) => argument.startsWith("--ids="));
  if (!idsArgument) return DEFAULT_SONG_IDS;

  const ids = idsArgument
    .slice("--ids=".length)
    .split(",")
    .map((value) => Number(value.trim()));

  if (
    ids.length === 0 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error("--ids must contain comma-separated positive integers");
  }

  return [...new Set(ids)];
}

function safeError(error: unknown): {
  code: string;
  message: string;
  status: typeof SyncStatus.FAILED | typeof SyncStatus.SOURCE_MISSING;
} {
  if (error instanceof VocaDbError) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      status:
        error.code === "NOT_FOUND"
          ? SyncStatus.SOURCE_MISSING
          : SyncStatus.FAILED,
    };
  }

  return {
    code: "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    status: SyncStatus.FAILED,
  };
}

async function main() {
  const ids = parseSongIds(process.argv.slice(2));
  const db = getDb();
  const client = new VocaDbClient({
    baseUrl: process.env.VOCADB_BASE_URL,
    userAgent: process.env.VOCADB_USER_AGENT,
    timeoutMs: process.env.VOCADB_TIMEOUT_MS
      ? Number(process.env.VOCADB_TIMEOUT_MS)
      : undefined,
  });

  const run = await db.syncRun.create({
    data: {
      requestedCount: ids.length,
      items: {
        create: ids.map((vocadbId) => ({ vocadbId })),
      },
    },
  });

  let successCount = 0;
  let failureCount = 0;

  for (let offset = 0; offset < ids.length; offset += CONCURRENCY) {
    const batch = ids.slice(offset, offset + CONCURRENCY);

    await Promise.all(
      batch.map(async (vocadbId) => {
        try {
          const source = await client.getSong(vocadbId);
          const result = await syncVocaDbSong(
            db,
            normalizeVocaDbSong(source),
          );

          await db.syncItem.update({
            where: {
              runId_vocadbId: { runId: run.id, vocadbId },
            },
            data: {
              status: result.status,
              attemptCount: 1,
              finishedAt: new Date(),
            },
          });

          successCount += 1;
          console.log(
            `VocaDB ${vocadbId}: ${result.status} /songs/${result.id}`,
          );
        } catch (error) {
          const details = safeError(error);
          failureCount += 1;

          await markSongSyncFailure(
            db,
            vocadbId,
            details.status,
            details.message,
          );
          await db.syncItem.update({
            where: {
              runId_vocadbId: { runId: run.id, vocadbId },
            },
            data: {
              status: details.status,
              attemptCount: 1,
              errorCode: details.code,
              errorMessage: details.message,
              finishedAt: new Date(),
            },
          });

          console.error(`VocaDB ${vocadbId}: ${details.code} ${details.message}`);
        }
      }),
    );
  }

  const status =
    failureCount === 0
      ? SyncRunStatus.SUCCEEDED
      : successCount === 0
        ? SyncRunStatus.FAILED
        : SyncRunStatus.PARTIAL;

  await db.syncRun.update({
    where: { id: run.id },
    data: {
      status,
      successCount,
      failureCount,
      finishedAt: new Date(),
    },
  });

  await db.$disconnect();

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "VocaDB sync failed");
  process.exitCode = 1;
});
