import type { PrismaClient } from "@/generated/prisma/client";
import { SyncEntity, SyncRunMode, SyncStatus } from "@/generated/prisma/enums";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import type { VocaDbClient } from "@/lib/vocadb/client";
import {
  beginItem,
  createIdsRun,
  type DurableDiscovery,
  type DurableItem,
  type DurableRunRecord,
  failItem,
  finishItem,
  normalizeIds,
  runDurableSync,
  safeError,
} from "@/lib/vocadb/durable-sync-runner";
import {
  isVocaDbCancellation,
  VocaDbCancellationError,
} from "@/lib/vocadb/errors";
import { normalizeVocaDbArtist } from "@/lib/vocadb/normalize";
import {
  markArtistSyncFailure,
  syncVocaDbArtistDetail,
} from "@/lib/vocadb/sync-artist";
import { DEFAULT_SYNC_CONCURRENCY } from "@/lib/vocadb/sync-runner";

export const DEFAULT_ARTIST_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

type Logger = Pick<Console, "log" | "error">;

export type ArtistSyncRunRequest =
  | { mode: typeof SyncRunMode.IDS; ids: number[] }
  | { mode: typeof SyncRunMode.REFRESH }
  | { mode: "AUTO"; target: typeof SyncRunMode.REFRESH }
  | { mode: "RESUME" };

export type ArtistSyncRunnerOptions = {
  db: PrismaClient;
  client: Pick<VocaDbClient, "getArtist">;
  now?: () => Date;
  logger?: Logger;
  concurrency?: number;
  refreshIntervalMs?: number;
  signal?: AbortSignal;
};

export async function runVocaDbArtistSync(
  request: ArtistSyncRunRequest,
  options: ArtistSyncRunnerOptions,
) {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SYNC_CONCURRENCY);
  const refreshIntervalMs = Math.max(
    0,
    options.refreshIntervalMs ?? DEFAULT_ARTIST_REFRESH_INTERVAL_MS,
  );

  return runDurableSync({
    db: options.db,
    entity: SyncEntity.ARTIST,
    requestMode: request.mode,
    autoTarget: request.mode === "AUTO" ? request.target : undefined,
    concurrency,
    now,
    logger,
    signal: options.signal,
    createRun: (mode) => createArtistRun(mode, request, options.db, now, refreshIntervalMs),
    discover: (run) => discoverArtistRun(run, options.db),
    processItem: (run, item) => processArtistItem(item, options, now, logger),
  });
}

async function createArtistRun(
  mode: string,
  request: ArtistSyncRunRequest,
  db: PrismaClient,
  now: () => Date,
  refreshIntervalMs: number,
): Promise<DurableRunRecord> {
  if (mode === SyncRunMode.IDS) {
    if (request.mode !== SyncRunMode.IDS) {
      throw new Error("Artist IDS run requires explicit source IDs");
    }
    const ids = normalizeIds(request.ids);
    const found = await db.artist.findMany({
      where: { vocadbId: { in: ids } },
      select: { vocadbId: true },
    });
    if (found.length !== ids.length) {
      const known = new Set(found.map((artist) => artist.vocadbId));
      const missing = ids.filter((id) => !known.has(id));
      throw new Error(`Unknown local artist IDs: ${missing.join(", ")}`);
    }
    return createIdsRun(db, SyncEntity.ARTIST, ids, now());
  }
  if (mode !== SyncRunMode.REFRESH) {
    throw new Error(`Unsupported artist sync mode: ${mode}`);
  }
  const timestamp = now();
  return db.syncRun.create({
    data: {
      entity: SyncEntity.ARTIST,
      mode: SyncRunMode.REFRESH,
      refreshCutoffAt: new Date(timestamp.getTime() - refreshIntervalMs),
    },
    select: runSelect,
  });
}

const runSelect = {
  id: true,
  entity: true,
  mode: true,
  status: true,
  discoveryCompletedAt: true,
  activityWindowStart: true,
  activityWindowEnd: true,
  baselineAt: true,
  refreshCutoffAt: true,
  expectedStateVersion: true,
} as const;

async function discoverArtistRun(
  run: DurableRunRecord,
  db: PrismaClient,
): Promise<DurableDiscovery> {
  if (run.mode !== SyncRunMode.REFRESH || !run.refreshCutoffAt) {
    throw new Error("Artist refresh run is missing its cutoff");
  }
  const artists = await db.artist.findMany({
    where: {
      songCredits: { some: { song: { is: PUBLIC_SONG_WHERE } } },
    },
    select: {
      vocadbId: true,
      sourceVersion: true,
      sourceStatus: true,
      sourceDeleted: true,
      summarySourceVersion: true,
      summarySourceStatus: true,
      summarySourceDeleted: true,
      summaryObservedAt: true,
      syncStatus: true,
      detailLastAttemptAt: true,
      detailLastSyncedAt: true,
    },
  });
  const ids = artists
    .filter((artist) => {
      const summaryChanged =
        artist.summarySourceVersion !== artist.sourceVersion ||
        artist.summarySourceStatus !== artist.sourceStatus ||
        artist.summarySourceDeleted !== artist.sourceDeleted;
      if (artist.syncStatus === SyncStatus.SOURCE_DELETED) {
        return (
          artist.summaryObservedAt !== null &&
          (artist.detailLastSyncedAt === null ||
            artist.summaryObservedAt > artist.detailLastSyncedAt)
        );
      }
      if (summaryChanged || artist.syncStatus === SyncStatus.FAILED) return true;
      if (artist.syncStatus === SyncStatus.SOURCE_MISSING) {
        return (
          !artist.detailLastAttemptAt ||
          artist.detailLastAttemptAt < run.refreshCutoffAt!
        );
      }
      if (!artist.detailLastSyncedAt) return true;
      return artist.detailLastSyncedAt < run.refreshCutoffAt!;
    })
    .map((artist) => artist.vocadbId);
  return { ids: normalizeIds(ids, true) };
}

async function processArtistItem(
  item: DurableItem,
  options: ArtistSyncRunnerOptions,
  now: () => Date,
  logger: Logger,
): Promise<void> {
  await beginItem(options.db, item.id, now());
  try {
    const source = await options.client.getArtist(item.vocadbId, {
      signal: options.signal,
    });
    const result = await syncVocaDbArtistDetail(
      options.db,
      normalizeVocaDbArtist(source),
      now(),
    );
    await finishItem(
      options.db,
      item.id,
      source.deleted ? SyncStatus.SOURCE_DELETED : SyncStatus.SYNCED,
      now(),
    );
    logger.log(`VocaDB artist ${item.vocadbId}: ${result.status} /artists/${result.id}`);
  } catch (error) {
    if (isVocaDbCancellation(error, options.signal)) {
      throw error instanceof VocaDbCancellationError
        ? error
        : new VocaDbCancellationError(options.signal?.reason);
    }
    const details = safeError(error);
    await markArtistSyncFailure(
      options.db,
      item.vocadbId,
      details.sourceMissing ? SyncStatus.SOURCE_MISSING : SyncStatus.FAILED,
      details.message,
      now(),
    );
    await failItem(options.db, item.id, error, now());
    logger.error(
      `VocaDB artist ${item.vocadbId}: ${details.code} ${details.message}`,
    );
  }
}
