import type { Prisma } from "@/generated/prisma/client";
import {
  SyncEntity,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import type {
  OperationsEntityStatusDto,
  OperationsResumableManifestDto,
  OperationsStatusDto,
  OperationsSyncRunDto,
} from "@/lib/operations/status-dto";
import {
  classifyOperationsStatus,
  DEFAULT_HEARTBEAT_STALE_AFTER_MS,
  DEFAULT_OPERATIONS_STATUS_STALE_AFTER_MS,
  isHeartbeatStale,
  validateHeartbeatStaleAfterMs,
  validateOperationsStatusStaleAfterMs,
} from "@/lib/operations/status-policy";
import { VOCADB_SONG_SYNC_STATE_ID } from "@/lib/catalog/sync-state";

const STATUS_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead",
  timeout: 15_000,
} as const;

const SONG_SYNC_STATE_SELECT = {
  activityCheckpoint: true,
  lastSeedCompletedAt: true,
  lastReconciledAt: true,
} satisfies Prisma.VocaDbSongSyncStateSelect;

const LATEST_RUN_SELECT = {
  id: true,
  mode: true,
  status: true,
  startedAt: true,
  discoveryCompletedAt: true,
  finishedAt: true,
  requestedCount: true,
  successCount: true,
  failureCount: true,
} satisfies Prisma.SyncRunSelect;

const RESUMABLE_MANIFEST_SELECT = {
  id: true,
  entity: true,
  sequence: true,
  mode: true,
  status: true,
  startedAt: true,
  discoveryCompletedAt: true,
  lastHeartbeatAt: true,
} satisfies Prisma.SyncRunSelect;

type StatusTransaction = Pick<
  ReturnType<typeof getDb>,
  "vocaDbSongSyncState" | "syncRun" | "syncItem"
>;

type LatestRun = Prisma.SyncRunGetPayload<{ select: typeof LATEST_RUN_SELECT }>;
type ResumableManifest = Prisma.SyncRunGetPayload<{
  select: typeof RESUMABLE_MANIFEST_SELECT;
}>;

export type OperationsStatusDb = {
  $transaction<T>(
    operation: (tx: StatusTransaction) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<T>;
};

export type OperationsStatusOptions = {
  now?: () => Date;
  staleAfterMs?: number;
  heartbeatStaleAfterMs?: number;
};

export async function getOperationsStatus(
  database: OperationsStatusDb = getDb(),
  options: OperationsStatusOptions = {},
): Promise<OperationsStatusDto> {
  const now = options.now?.() ?? new Date();
  const staleAfterMs = validateOperationsStatusStaleAfterMs(
    options.staleAfterMs ?? DEFAULT_OPERATIONS_STATUS_STALE_AFTER_MS,
  );
  const heartbeatStaleAfterMs = validateHeartbeatStaleAfterMs(
    options.heartbeatStaleAfterMs ?? DEFAULT_HEARTBEAT_STALE_AFTER_MS,
  );

  return database.$transaction(async (tx) => {
    const [state, latestSongRun, latestArtistRun, latestSongTerminalRun, latestArtistTerminalRun, resumableRuns] =
      await Promise.all([
        tx.vocaDbSongSyncState.findUnique({
          where: { id: VOCADB_SONG_SYNC_STATE_ID },
          select: SONG_SYNC_STATE_SELECT,
        }),
        findLatestRun(tx, SyncEntity.SONG),
        findLatestRun(tx, SyncEntity.ARTIST),
        findLatestTerminalRun(tx, SyncEntity.SONG),
        findLatestTerminalRun(tx, SyncEntity.ARTIST),
        tx.syncRun.findMany({
          where: { status: SyncRunStatus.RUNNING },
          orderBy: [{ entity: "asc" }, { sequence: "asc" }],
          select: RESUMABLE_MANIFEST_SELECT,
        }),
      ]);

    const allRuns = [latestSongRun, latestArtistRun, ...resumableRuns];
    const runIds = [...new Set(allRuns.flatMap((run) => (run ? [run.id] : [])))];
    const itemGroups = runIds.length > 0
      ? await tx.syncItem.groupBy({
          by: ["runId", "status"],
          where: { runId: { in: runIds } },
          _count: { _all: true },
        })
      : [];
    const itemCountsByRun = itemCountsByRunId(runIds, itemGroups);
    const pendingItemCounts = pendingItemCountsByRunId(runIds, itemGroups);

    const songRunningManifestCount = resumableRuns.filter(
      (run) => run.entity === SyncEntity.SONG,
    ).length;
    const artistRunningManifestCount = resumableRuns.filter(
      (run) => run.entity === SyncEntity.ARTIST,
    ).length;

    return {
      classification: classifyOperationsStatus(
        {
          lastSeedCompletedAt: state?.lastSeedCompletedAt ?? null,
          activityCheckpoint: state?.activityCheckpoint ?? null,
          lastReconciledAt: state?.lastReconciledAt ?? null,
          latestTerminalRunStatuses: [
            latestSongTerminalRun?.status ?? null,
            latestArtistTerminalRun?.status ?? null,
          ],
          hasMultipleRunningManifests:
            songRunningManifestCount > 1 || artistRunningManifestCount > 1,
          resumableHeartbeats: resumableRuns.map(
            (run) => run.lastHeartbeatAt,
          ),
        },
        now,
        staleAfterMs,
        heartbeatStaleAfterMs,
      ),
      observedAt: now.toISOString(),
      staleAfterMs,
      songs: {
        activityCheckpoint: state?.activityCheckpoint?.toISOString() ?? null,
        lastSeedCompletedAt: state?.lastSeedCompletedAt?.toISOString() ?? null,
        lastReconciledAt: state?.lastReconciledAt?.toISOString() ?? null,
        ...entityStatus(latestSongRun, songRunningManifestCount, itemCountsByRun),
      },
      artists: entityStatus(
        latestArtistRun,
        artistRunningManifestCount,
        itemCountsByRun,
      ),
      resumableManifests: resumableRuns.map((run) =>
        resumableManifestDto(run, pendingItemCounts, now, heartbeatStaleAfterMs),
      ),
    };
  }, STATUS_TRANSACTION_OPTIONS);
}

async function findLatestRun(
  tx: StatusTransaction,
  entity: typeof SyncEntity.SONG | typeof SyncEntity.ARTIST,
): Promise<LatestRun | null> {
  return tx.syncRun.findFirst({
    where: { entity },
    orderBy: { sequence: "desc" },
    select: LATEST_RUN_SELECT,
  });
}

async function findLatestTerminalRun(
  tx: StatusTransaction,
  entity: typeof SyncEntity.SONG | typeof SyncEntity.ARTIST,
): Promise<Pick<LatestRun, "status"> | null> {
  return tx.syncRun.findFirst({
    where: { entity, status: { not: SyncRunStatus.RUNNING } },
    orderBy: { sequence: "desc" },
    select: { status: true },
  });
}

function entityStatus(
  latestRun: LatestRun | null,
  runningManifestCount: number,
  itemCountsByRun: Map<string, OperationsSyncRunDto["itemCounts"]>,
): OperationsEntityStatusDto {
  return {
    runningManifestCount,
    latestRun: latestRun
      ? {
          mode: latestRun.mode,
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          discoveryCompletedAt: latestRun.discoveryCompletedAt?.toISOString() ?? null,
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          requestedCount: latestRun.requestedCount,
          successCount: latestRun.successCount,
          failureCount: latestRun.failureCount,
          itemCounts: itemCountsByRun.get(latestRun.id) ?? emptyItemCounts(),
        }
      : null,
  };
}

function resumableManifestDto(
  run: ResumableManifest,
  pendingItemCounts: Map<string, number>,
  now: Date,
  heartbeatStaleAfterMs: number,
): OperationsResumableManifestDto {
  return {
    entity: run.entity,
    sequence: run.sequence.toString(),
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    discoveryCompletedAt: run.discoveryCompletedAt?.toISOString() ?? null,
    pendingItemCount: pendingItemCounts.get(run.id) ?? 0,
    lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
    heartbeatStale: isHeartbeatStale(
      now,
      run.lastHeartbeatAt,
      heartbeatStaleAfterMs,
    ),
  };
}

function itemCountsByRunId(
  runIds: string[],
  groups: Array<{ runId: string; status: keyof OperationsSyncRunDto["itemCounts"]; _count: { _all: number } }>,
): Map<string, OperationsSyncRunDto["itemCounts"]> {
  const counts = new Map(
    runIds.map((runId) => [runId, emptyItemCounts()]),
  );
  for (const group of groups) {
    counts.get(group.runId)![group.status] = group._count._all;
  }
  return counts;
}

function pendingItemCountsByRunId(
  runIds: string[],
  groups: Array<{ runId: string; status: keyof OperationsSyncRunDto["itemCounts"]; _count: { _all: number } }>,
): Map<string, number> {
  const counts = new Map(runIds.map((runId) => [runId, 0]));
  for (const group of groups) {
    if (group.status === SyncStatus.PENDING) counts.set(group.runId, group._count._all);
  }
  return counts;
}

function emptyItemCounts(): OperationsSyncRunDto["itemCounts"] {
  return {
    [SyncStatus.PENDING]: 0,
    [SyncStatus.SYNCED]: 0,
    [SyncStatus.FAILED]: 0,
    [SyncStatus.SOURCE_MISSING]: 0,
    [SyncStatus.SOURCE_DELETED]: 0,
  };
}
