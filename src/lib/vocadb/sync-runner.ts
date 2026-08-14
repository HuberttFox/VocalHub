import type { PrismaClient } from "@/generated/prisma/client";
import { VOCADB_SONG_SYNC_STATE_ID } from "@/lib/catalog/sync-state";
import {
  SyncEntity,
  SyncRunMode,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";
import {
  VOCADB_ACTIVITY_MAX_RESULTS,
  type VocaDbClient,
} from "@/lib/vocadb/client";
import {
  beginItem,
  createIdsRun,
  type DurableDiscovery,
  type DurableItem,
  type DurableRunResult,
  type DurableRunRecord,
  failItem,
  finishItem,
  normalizeIds as normalizeSourceIds,
  runDurableSync,
  safeError,
} from "@/lib/vocadb/durable-sync-runner";
import {
  isVocaDbCancellation,
  throwIfVocaDbCancelled,
  VocaDbCancellationError,
} from "@/lib/vocadb/errors";
import {
  invalidateDiscoveryCatalog,
  materializeDiscoverySnapshots,
} from "@/lib/discover/materializer";
import { getDiscoveryMaterializerBatchTiming } from "@/lib/discover/materializer-timing";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import {
  markSongSourceDeleted,
  markSongSyncFailure,
  syncVocaDbSong,
} from "@/lib/vocadb/sync-song";

export { VOCADB_SONG_SYNC_STATE_ID } from "@/lib/catalog/sync-state";
export const DEFAULT_SYNC_CONCURRENCY = 2;
export const DEFAULT_ACTIVITY_OVERLAP_MS = 15 * 60 * 1_000;
export const DEFAULT_SETTLEMENT_LAG_MS = 2 * 60 * 1_000;
const MIN_ACTIVITY_SLICE_MS = 1;
const DISCOVERY_MATERIALIZER_LIMIT = 100;

type Logger = Pick<Console, "log" | "error">;

export type SyncRunRequest =
  | { mode: typeof SyncRunMode.IDS; ids: number[] }
  | { mode: typeof SyncRunMode.SEED }
  | { mode: typeof SyncRunMode.INCREMENTAL }
  | { mode: typeof SyncRunMode.RECONCILE }
  | {
      mode: "AUTO";
      target:
        | typeof SyncRunMode.SEED
        | typeof SyncRunMode.INCREMENTAL
        | typeof SyncRunMode.RECONCILE;
    }
  | { mode: "RESUME" };

export type SyncRunnerOptions = {
  db: PrismaClient;
  client: Pick<
    VocaDbClient,
    "getSong" | "getSongIds" | "getSongActivityEntries"
  >;
  now?: () => Date;
  logger?: Logger;
  concurrency?: number;
  activityOverlapMs?: number;
  settlementLagMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
  materializeDiscovery?: boolean;
};

export type SyncRunResult = DurableRunResult;

export class ActivityIntervalSaturatedError extends Error {
  readonly code = "ACTIVITY_INTERVAL_SATURATED";

  constructor() {
    super("VocaDB activity interval cannot be exhaustively subdivided");
    this.name = "ActivityIntervalSaturatedError";
  }
}

export async function runVocaDbSongSync(
  request: SyncRunRequest,
  options: SyncRunnerOptions,
): Promise<SyncRunResult> {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SYNC_CONCURRENCY);
  const overlapMs = Math.max(
    0,
    options.activityOverlapMs ?? DEFAULT_ACTIVITY_OVERLAP_MS,
  );
  const settlementLagMs = Math.max(
    0,
    options.settlementLagMs ?? DEFAULT_SETTLEMENT_LAG_MS,
  );

  const result = await runDurableSync({
      db: options.db,
      entity: SyncEntity.SONG,
      requestMode: request.mode,
      autoTarget: request.mode === "AUTO" ? request.target : undefined,
      concurrency,
      now,
      logger,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      signal: options.signal,
      createRun: (mode) => createSongRun(mode, request, options.db, now, overlapMs, settlementLagMs),
      discover: (run) => discoverSongRun(run, options.db, options.client, options.signal),
      processItem: (run, item) =>
        processSongItem(run, item, options, now, logger),
      advanceState: advanceSongState,
      finalizeRun: finalizeSongRun,
      interruptRun: interruptSongRun,
    });
  if (options.materializeDiscovery === false || !result.catalogChanged || result.status === SyncRunStatus.FAILED) {
    return result;
  }

  try {
    await materializeDiscoverySnapshots(DISCOVERY_MATERIALIZER_LIMIT, options.db, {
      batchTiming: getDiscoveryMaterializerBatchTiming(),
    });
  } catch (error) {
    logger.error(
      `Discovery materialization failed after song sync: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return result;
}

async function createSongRun(
  mode: string,
  request: SyncRunRequest,
  db: PrismaClient,
  now: () => Date,
  overlapMs: number,
  settlementLagMs: number,
): Promise<DurableRunRecord> {
  if (mode === SyncRunMode.IDS) {
    if (request.mode !== SyncRunMode.IDS) {
      throw new Error("IDS run requires explicit source IDs");
    }
    return createIdsRun(db, SyncEntity.SONG, request.ids, now());
  }

  if (
    mode !== SyncRunMode.SEED &&
    mode !== SyncRunMode.INCREMENTAL &&
    mode !== SyncRunMode.RECONCILE
  ) {
    throw new Error(`Unsupported song sync mode: ${mode}`);
  }

  const state = await db.vocaDbSongSyncState.upsert({
    where: { id: VOCADB_SONG_SYNC_STATE_ID },
    create: { id: VOCADB_SONG_SYNC_STATE_ID },
    update: {},
  });
  const select = runSelect;
  if (mode === SyncRunMode.INCREMENTAL) {
    if (!state.activityCheckpoint || !state.lastSeedCompletedAt) {
      throw new Error("Incremental sync requires a completed seed");
    }
    const candidate = new Date(now().getTime() - settlementLagMs);
    const activityWindowEnd = candidate > state.activityCheckpoint
      ? candidate
      : state.activityCheckpoint;
    const activityWindowStart = new Date(
      Math.min(
        state.activityCheckpoint.getTime() - overlapMs,
        activityWindowEnd.getTime() - MIN_ACTIVITY_SLICE_MS,
      ),
    );
    return db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode,
        activityWindowStart,
        activityWindowEnd,
        expectedStateVersion: state.version,
      },
      select,
    });
  }

  return db.syncRun.create({
    data: {
      entity: SyncEntity.SONG,
      mode,
      baselineAt: mode === SyncRunMode.SEED ? now() : undefined,
      expectedStateVersion: state.version,
    },
    select,
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

async function discoverSongRun(
  run: DurableRunRecord,
  db: PrismaClient,
  client: SyncRunnerOptions["client"],
  signal?: AbortSignal,
): Promise<DurableDiscovery> {
  if (run.mode === SyncRunMode.IDS) {
    throw new Error("IDS run manifest must be created atomically");
  }
  if (run.mode === SyncRunMode.SEED) {
    return { ids: await client.getSongIds({ signal }) };
  }
  if (run.mode === SyncRunMode.INCREMENTAL) {
    if (!run.activityWindowStart || !run.activityWindowEnd) {
      throw new Error("Incremental run is missing activity window boundaries");
    }
    return {
      ids: await discoverActivityIds(
        client,
        run.activityWindowStart,
        run.activityWindowEnd,
        signal,
      ),
    };
  }
  if (run.mode === SyncRunMode.RECONCILE) {
    const inventoryIds = await client.getSongIds({ signal });
    const inventory = new Set(inventoryIds);
    const local = await db.song.findMany({
      where: {
        OR: [{ sourceDeleted: false }, { syncStatus: SyncStatus.SOURCE_MISSING }],
      },
      select: { vocadbId: true, syncStatus: true, sourceDeleted: true },
    });
    const ids = local
      .filter(
        (song) =>
          (!song.sourceDeleted && !inventory.has(song.vocadbId)) ||
          song.syncStatus === SyncStatus.SOURCE_MISSING,
      )
      .map((song) => song.vocadbId);
    return { ids: normalizeIds(ids, true), inventoryIds };
  }
  throw new Error(`Unsupported song run mode: ${run.mode}`);
}

async function processSongItem(
  run: DurableRunRecord,
  item: DurableItem,
  options: SyncRunnerOptions,
  now: () => Date,
  logger: Logger,
): Promise<void> {
  await beginItem(options.db, item.id, now());
  try {
    const source = await options.client.getSong(item.vocadbId, {
      signal: options.signal,
    });
    const result = await syncVocaDbSong(
      options.db,
      normalizeVocaDbSong(source),
      now(),
      { syncRunId: run.id },
    );
    await finishItem(
      options.db,
      item.id,
      source.deleted ? SyncStatus.SOURCE_DELETED : SyncStatus.SYNCED,
      now(),
    );
    logger.log(`VocaDB ${item.vocadbId}: ${result.status} /songs/${result.id}`);
  } catch (error) {
    if (isVocaDbCancellation(error, options.signal)) {
      throw error instanceof VocaDbCancellationError
        ? error
        : new VocaDbCancellationError(options.signal?.reason);
    }
    const details = safeError(error);
    if (
      run.mode === SyncRunMode.RECONCILE &&
      details.sourceMissing &&
      item.sourcePresent === false
    ) {
      await markSongSourceDeleted(
        options.db,
        item.vocadbId,
        "Absent from complete VocaDB inventory and detail returned 404",
        { syncRunId: run.id },
      );
      await finishItem(options.db, item.id, SyncStatus.SOURCE_DELETED, now());
      logger.log(`VocaDB ${item.vocadbId}: SOURCE_DELETED`);
      return;
    }
    if (
      run.mode === SyncRunMode.RECONCILE &&
      details.sourceMissing &&
      item.sourcePresent === true
    ) {
      const message =
        "VocaDB inventory contains the song but canonical detail returned 404";
      await markSongSyncFailure(
        options.db,
        item.vocadbId,
        SyncStatus.SOURCE_MISSING,
        message,
        { syncRunId: run.id },
      );
      await options.db.syncItem.update({
        where: { id: item.id },
        data: {
          status: SyncStatus.FAILED,
          errorCode: "CONTRADICTORY_SOURCE_STATE",
          errorMessage: message,
          finishedAt: now(),
        },
      });
      logger.error(`VocaDB ${item.vocadbId}: ${message}`);
      return;
    }

    await markSongSyncFailure(
      options.db,
      item.vocadbId,
      details.sourceMissing ? SyncStatus.SOURCE_MISSING : SyncStatus.FAILED,
      details.message,
      { syncRunId: run.id },
    );
    await failItem(options.db, item.id, error, now());
    logger.error(`VocaDB ${item.vocadbId}: ${details.code} ${details.message}`);
  }
}

type TransactionDb = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function consumeSongRunCatalogChange(
  tx: TransactionDb,
  run: DurableRunRecord,
): Promise<boolean> {
  const consumed = await tx.syncRun.updateMany({
    where: { id: run.id, catalogChanged: true },
    data: { catalogChanged: false },
  });
  if (consumed.count === 0) return false;
  await invalidateDiscoveryCatalog(tx);
  return true;
}

async function finalizeSongRun(
  tx: TransactionDb,
  run: DurableRunRecord,
): Promise<boolean> {
  return consumeSongRunCatalogChange(tx, run);
}

async function interruptSongRun(
  tx: TransactionDb,
  run: DurableRunRecord,
): Promise<void> {
  await consumeSongRunCatalogChange(tx, run);
}

async function advanceSongState(
  tx: TransactionDb,
  run: DurableRunRecord,
  finishedAt: Date,
): Promise<void> {
  if (run.mode === SyncRunMode.IDS) return;
  if (run.expectedStateVersion === null) {
    throw new Error("Sync run has no expected state version");
  }
  const data = run.mode === SyncRunMode.SEED
    ? {
        version: { increment: 1 },
        activityCheckpoint: run.baselineAt,
        lastSeedCompletedAt: finishedAt,
      }
    : run.mode === SyncRunMode.INCREMENTAL
      ? { version: { increment: 1 }, activityCheckpoint: run.activityWindowEnd }
      : { version: { increment: 1 }, lastReconciledAt: finishedAt };
  const updated = await tx.vocaDbSongSyncState.updateMany({
    where: {
      id: VOCADB_SONG_SYNC_STATE_ID,
      version: run.expectedStateVersion,
    },
    data,
  });
  if (updated.count !== 1) {
    throw new Error("Sync checkpoint changed while the run was active");
  }
}

export async function discoverActivityIds(
  client: Pick<VocaDbClient, "getSongActivityEntries">,
  since: Date,
  before: Date,
  signal?: AbortSignal,
): Promise<number[]> {
  const ids = new Set<number>();
  await collectActivityIds(client, since, before, ids, signal);
  return [...ids].sort((left, right) => left - right);
}

async function collectActivityIds(
  client: Pick<VocaDbClient, "getSongActivityEntries">,
  since: Date,
  before: Date,
  ids: Set<number>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfVocaDbCancelled(signal);
  const entries = await client.getSongActivityEntries({ since, before, signal });
  if (entries.length < VOCADB_ACTIVITY_MAX_RESULTS) {
    for (const entry of entries) ids.add(entry.entry.id);
    return;
  }

  const span = before.getTime() - since.getTime();
  if (span <= MIN_ACTIVITY_SLICE_MS) {
    throw new ActivityIntervalSaturatedError();
  }
  const midpoint = new Date(since.getTime() + Math.floor(span / 2));
  if (midpoint <= since || midpoint >= before) {
    throw new ActivityIntervalSaturatedError();
  }
  const rightSince = new Date(midpoint.getTime() - MIN_ACTIVITY_SLICE_MS);
  if (rightSince <= since || rightSince >= before) {
    throw new ActivityIntervalSaturatedError();
  }
  await collectActivityIds(client, since, midpoint, ids, signal);
  await collectActivityIds(client, rightSince, before, ids, signal);
}

export { digestIds } from "@/lib/vocadb/durable-sync-runner";
export function normalizeIds(ids: number[], allowEmpty = false): number[] {
  return normalizeSourceIds(ids, allowEmpty, "Song IDs");
}
