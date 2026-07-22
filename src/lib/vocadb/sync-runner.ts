import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { SyncRunMode, SyncRunStatus, SyncStatus } from "@/generated/prisma/enums";
import {
  VOCADB_ACTIVITY_MAX_RESULTS,
  type VocaDbClient,
} from "@/lib/vocadb/client";
import {
  isVocaDbCancellation,
  throwIfVocaDbCancelled,
  VocaDbCancellationError,
  VocaDbError,
} from "@/lib/vocadb/errors";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import {
  markSongSourceDeleted,
  markSongSyncFailure,
  syncVocaDbSong,
} from "@/lib/vocadb/sync-song";

export const VOCADB_SONG_SYNC_STATE_ID = "vocadb:songs";
export const DEFAULT_SYNC_CONCURRENCY = 2;
export const DEFAULT_ACTIVITY_OVERLAP_MS = 15 * 60 * 1_000;
export const DEFAULT_SETTLEMENT_LAG_MS = 2 * 60 * 1_000;
const MIN_ACTIVITY_SLICE_MS = 1;

type Logger = Pick<Console, "log" | "error">;

type RunMode = (typeof SyncRunMode)[keyof typeof SyncRunMode];

type RunRecord = {
  id: string;
  mode: RunMode;
  status: (typeof SyncRunStatus)[keyof typeof SyncRunStatus];
  discoveryCompletedAt: Date | null;
  activityWindowStart: Date | null;
  activityWindowEnd: Date | null;
  baselineAt: Date | null;
  expectedStateVersion: number | null;
};

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
  signal?: AbortSignal;
};

export type SyncRunResult = {
  runId: string;
  status: (typeof SyncRunStatus)[keyof typeof SyncRunStatus];
  successCount: number;
  failureCount: number;
};

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

  throwIfVocaDbCancelled(options.signal);
  let run: RunRecord;
  if (request.mode === "RESUME") {
    run = await getRunningRun(options.db);
    await clearRunError(options.db, run.id);
  } else if (request.mode === "AUTO") {
    const running = await findRunningRuns(options.db);
    if (running.length > 1) {
      throw new Error("Multiple running sync runs require operator intervention");
    }
    if (running.length === 1) {
      run = running[0];
      await clearRunError(options.db, run.id);
      logger.log(
        `Scheduled ${request.target} sync resumes ${run.mode} run ${run.id}`,
      );
    } else {
      const targetRequest = { mode: request.target };
      run = await createRun(
        targetRequest,
        options.db,
        now,
        overlapMs,
        settlementLagMs,
      );
    }
  } else {
    await assertNoRunningRun(options.db);
    run = await createRun(request, options.db, now, overlapMs, settlementLagMs);
  }

  try {
    throwIfVocaDbCancelled(options.signal);
    if (!run.discoveryCompletedAt) {
      const discovery = await discoverRun(
        run,
        options.db,
        options.client,
        options.signal,
      );
      throwIfVocaDbCancelled(options.signal);
      await persistManifest(options.db, run.id, discovery, now());
      run = { ...run, discoveryCompletedAt: now() };
    }

    await processPendingItems(run, options, concurrency, now, logger);
    throwIfVocaDbCancelled(options.signal);
    return await finalizeRun(options.db, run, now());
  } catch (error) {
    await recordRunInterruption(options.db, run.id, error);
    throw error;
  }
}

async function createRun(
  request: Exclude<SyncRunRequest, { mode: "RESUME" } | { mode: "AUTO" }>,
  db: PrismaClient,
  now: () => Date,
  overlapMs: number,
  settlementLagMs: number,
): Promise<RunRecord> {
  if (request.mode === SyncRunMode.IDS) {
    const ids = normalizeIds(request.ids);
    const timestamp = now();
    return db.syncRun.create({
      data: {
        mode: request.mode,
        requestedCount: ids.length,
        sourceIdCount: ids.length,
        sourceIdDigest: digestIds(ids),
        discoveryCompletedAt: timestamp,
        items: {
          create: ids.map((vocadbId) => ({ vocadbId })),
        },
      },
      select: runSelect,
    });
  }

  const state = await db.vocaDbSongSyncState.upsert({
    where: { id: VOCADB_SONG_SYNC_STATE_ID },
    create: { id: VOCADB_SONG_SYNC_STATE_ID },
    update: {},
  });

  if (request.mode === SyncRunMode.INCREMENTAL) {
    if (!state.activityCheckpoint || !state.lastSeedCompletedAt) {
      throw new Error("Incremental sync requires a completed seed");
    }
    const activityWindowEndCandidate = new Date(now().getTime() - settlementLagMs);
    const activityWindowEnd =
      activityWindowEndCandidate > state.activityCheckpoint
        ? activityWindowEndCandidate
        : state.activityCheckpoint;
    const activityWindowStart = new Date(
      Math.min(
        state.activityCheckpoint.getTime() - overlapMs,
        activityWindowEnd.getTime() - MIN_ACTIVITY_SLICE_MS,
      ),
    );
    return db.syncRun.create({
      data: {
        mode: request.mode,
        activityWindowStart,
        activityWindowEnd,
        expectedStateVersion: state.version,
      },
      select: runSelect,
    });
  }

  return db.syncRun.create({
    data: {
      mode: request.mode,
      baselineAt: request.mode === SyncRunMode.SEED ? now() : undefined,
      expectedStateVersion: state.version,
    },
    select: runSelect,
  });
}

const runSelect = {
  id: true,
  mode: true,
  status: true,
  discoveryCompletedAt: true,
  activityWindowStart: true,
  activityWindowEnd: true,
  baselineAt: true,
  expectedStateVersion: true,
} as const;

async function findRunningRuns(db: PrismaClient): Promise<RunRecord[]> {
  return db.syncRun.findMany({
    where: { status: SyncRunStatus.RUNNING },
    orderBy: { sequence: "asc" },
    take: 2,
    select: runSelect,
  });
}

async function getRunningRun(db: PrismaClient): Promise<RunRecord> {
  const runs = await findRunningRuns(db);
  if (runs.length !== 1) {
    throw new Error(
      runs.length === 0
        ? "No running sync run to resume"
        : "Multiple running sync runs require operator intervention",
    );
  }
  return runs[0];
}

async function clearRunError(db: PrismaClient, runId: string): Promise<void> {
  await db.syncRun.update({
    where: { id: runId },
    data: { errorCode: null, errorMessage: null },
  });
}

async function assertNoRunningRun(db: PrismaClient): Promise<void> {
  if ((await findRunningRuns(db)).length > 0) {
    throw new Error("A sync run is already running; use resume");
  }
}

type Discovery = {
  ids: number[];
  inventoryIds?: number[];
};

async function discoverRun(
  run: RunRecord,
  db: PrismaClient,
  client: SyncRunnerOptions["client"],
  signal?: AbortSignal,
): Promise<Discovery> {
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
        OR: [
          { sourceDeleted: false },
          { syncStatus: SyncStatus.SOURCE_MISSING },
        ],
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

  throw new Error(`Unsupported run mode: ${run.mode}`);
}

async function persistManifest(
  db: PrismaClient,
  runId: string,
  discovery: Discovery,
  completedAt: Date,
): Promise<void> {
  const ids = normalizeIds(discovery.ids, true);
  const inventory = discovery.inventoryIds
    ? new Set(discovery.inventoryIds)
    : undefined;
  await db.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.syncItem.createMany({
        data: ids.map((vocadbId) => ({
          runId,
          vocadbId,
          sourcePresent: inventory?.has(vocadbId),
        })),
        skipDuplicates: true,
      });
    }
    const sourceIds = discovery.inventoryIds ?? ids;
    await tx.syncRun.update({
      where: { id: runId },
      data: {
        requestedCount: ids.length,
        sourceIdCount: sourceIds.length,
        sourceIdDigest: digestIds(sourceIds),
        discoveryCompletedAt: completedAt,
      },
    });
  });
}

async function processPendingItems(
  run: RunRecord,
  options: SyncRunnerOptions,
  concurrency: number,
  now: () => Date,
  logger: Logger,
): Promise<void> {
  const items = await options.db.syncItem.findMany({
    where: { runId: run.id, status: SyncStatus.PENDING },
    orderBy: { vocadbId: "asc" },
    select: { id: true, vocadbId: true, sourcePresent: true },
  });

  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;
  const lanes = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!stopped && nextIndex < items.length) {
        try {
          throwIfVocaDbCancelled(options.signal);
          const item = items[nextIndex];
          nextIndex += 1;
          await processItem(run, item, options, now, logger);
        } catch (error) {
          stopped = true;
          firstError ??= error;
        }
      }
    },
  );
  await Promise.allSettled(lanes);
  if (firstError !== undefined) throw firstError;
}

async function processItem(
  run: RunRecord,
  item: { id: string; vocadbId: number; sourcePresent: boolean | null },
  options: SyncRunnerOptions,
  now: () => Date,
  logger: Logger,
): Promise<void> {
  const startedAt = now();
  await options.db.syncItem.update({
    where: { id: item.id },
    data: {
      startedAt: { set: startedAt },
      lastAttemptAt: startedAt,
      attemptCount: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    },
  });

  try {
    const source = await options.client.getSong(item.vocadbId, {
      signal: options.signal,
    });
    const result = await syncVocaDbSong(
      options.db,
      normalizeVocaDbSong(source),
      now(),
    );
    const status = source.deleted
      ? SyncStatus.SOURCE_DELETED
      : SyncStatus.SYNCED;
    await finishItem(options.db, item.id, status, now());
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
      details.status === SyncStatus.SOURCE_MISSING &&
      item.sourcePresent === false
    ) {
      await markSongSourceDeleted(
        options.db,
        item.vocadbId,
        "Absent from complete VocaDB inventory and detail returned 404",
      );
      await finishItem(options.db, item.id, SyncStatus.SOURCE_DELETED, now());
      logger.log(`VocaDB ${item.vocadbId}: SOURCE_DELETED`);
      return;
    }

    if (
      run.mode === SyncRunMode.RECONCILE &&
      details.status === SyncStatus.SOURCE_MISSING &&
      item.sourcePresent === true
    ) {
      const message =
        "VocaDB inventory contains the song but canonical detail returned 404";
      await markSongSyncFailure(
        options.db,
        item.vocadbId,
        SyncStatus.SOURCE_MISSING,
        message,
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
      details.status,
      details.message,
    );
    await options.db.syncItem.update({
      where: { id: item.id },
      data: {
        status:
          details.status === SyncStatus.SOURCE_MISSING
            ? SyncStatus.FAILED
            : details.status,
        errorCode: details.code,
        errorMessage: details.message,
        finishedAt: now(),
      },
    });
    logger.error(`VocaDB ${item.vocadbId}: ${details.code} ${details.message}`);
  }
}

async function finishItem(
  db: PrismaClient,
  itemId: string,
  status: typeof SyncStatus.SYNCED | typeof SyncStatus.SOURCE_DELETED,
  finishedAt: Date,
): Promise<void> {
  await db.syncItem.update({
    where: { id: itemId },
    data: { status, finishedAt },
  });
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

async function finalizeRun(
  db: PrismaClient,
  run: RunRecord,
  finishedAt: Date,
): Promise<SyncRunResult> {
  const [failureCount, successCount] = await Promise.all([
    db.syncItem.count({
      where: {
        runId: run.id,
        status: { in: [SyncStatus.FAILED, SyncStatus.SOURCE_MISSING] },
      },
    }),
    db.syncItem.count({
      where: {
        runId: run.id,
        status: {
          in: [
            SyncStatus.SYNCED,
            SyncStatus.SOURCE_DELETED,
          ],
        },
      },
    }),
  ]);
  const status =
    failureCount === 0
      ? SyncRunStatus.SUCCEEDED
      : successCount === 0
        ? SyncRunStatus.FAILED
        : SyncRunStatus.PARTIAL;

  await db.$transaction(async (tx) => {
    if (failureCount === 0) {
      await advanceState(tx, run, finishedAt);
    }
    await tx.syncRun.update({
      where: { id: run.id },
      data: {
        status,
        successCount,
        failureCount,
        finishedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
  });

  return { runId: run.id, status, successCount, failureCount };
}

type TransactionDb = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

async function advanceState(
  tx: TransactionDb,
  run: RunRecord,
  finishedAt: Date,
): Promise<void> {
  if (run.mode === SyncRunMode.IDS) return;
  const expectedVersion = run.expectedStateVersion;
  if (expectedVersion === null) {
    throw new Error("Sync run has no expected state version");
  }

  const data =
    run.mode === SyncRunMode.SEED
      ? {
          version: { increment: 1 },
          activityCheckpoint: run.baselineAt,
          lastSeedCompletedAt: finishedAt,
        }
      : run.mode === SyncRunMode.INCREMENTAL
        ? {
            version: { increment: 1 },
            activityCheckpoint: run.activityWindowEnd,
          }
        : {
            version: { increment: 1 },
            lastReconciledAt: finishedAt,
          };

  const updated = await tx.vocaDbSongSyncState.updateMany({
    where: { id: VOCADB_SONG_SYNC_STATE_ID, version: expectedVersion },
    data,
  });
  if (updated.count !== 1) {
    throw new Error("Sync checkpoint changed while the run was active");
  }
}

async function recordRunInterruption(
  db: PrismaClient,
  runId: string,
  error: unknown,
): Promise<void> {
  const details = safeRunError(error);
  await db.syncRun.updateMany({
    where: { id: runId, status: SyncRunStatus.RUNNING },
    data: {
      errorCode: details.code,
      errorMessage: details.message,
    },
  });
}

function safeRunError(error: unknown): { code: string; message: string } {
  if (error instanceof ActivityIntervalSaturatedError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof VocaDbError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
  };
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
  if (
    midpoint.getTime() <= since.getTime() ||
    midpoint.getTime() >= before.getTime()
  ) {
    throw new ActivityIntervalSaturatedError();
  }

  const leftBefore = midpoint;
  const rightSince = new Date(midpoint.getTime() - MIN_ACTIVITY_SLICE_MS);
  if (
    leftBefore.getTime() <= since.getTime() ||
    rightSince.getTime() <= since.getTime() ||
    rightSince.getTime() >= before.getTime()
  ) {
    throw new ActivityIntervalSaturatedError();
  }

  await collectActivityIds(client, since, leftBefore, ids, signal);
  await collectActivityIds(client, rightSince, before, ids, signal);
}

export function digestIds(ids: number[]): string {
  return createHash("sha256")
    .update(normalizeIds(ids, true).join(","))
    .digest("hex");
}

export function normalizeIds(ids: number[], allowEmpty = false): number[] {
  if (
    (!allowEmpty && ids.length === 0) ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new TypeError("Song IDs must contain positive safe integers");
  }
  return [...new Set(ids)].sort((left, right) => left - right);
}
