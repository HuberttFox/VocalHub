import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  SyncEntity,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";
import {
  isVocaDbCancellation,
  throwIfVocaDbCancelled,
  VocaDbCancellationError,
  VocaDbError,
} from "@/lib/vocadb/errors";

export type Logger = Pick<Console, "log" | "error">;
export type Entity = (typeof SyncEntity)[keyof typeof SyncEntity];

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export type DurableRunRecord = {
  id: string;
  entity: Entity;
  mode: string;
  status: (typeof SyncRunStatus)[keyof typeof SyncRunStatus];
  discoveryCompletedAt: Date | null;
  activityWindowStart: Date | null;
  activityWindowEnd: Date | null;
  baselineAt: Date | null;
  refreshCutoffAt: Date | null;
  expectedStateVersion: number | null;
};

export type DurableItem = {
  id: string;
  vocadbId: number;
  sourcePresent: boolean | null;
};

export type DurableDiscovery = {
  ids: number[];
  inventoryIds?: number[];
};

export type DurableRunResult = {
  runId: string;
  status: (typeof SyncRunStatus)[keyof typeof SyncRunStatus];
  successCount: number;
  failureCount: number;
};

export type DurableRunnerOptions = {
  db: PrismaClient;
  entity: Entity;
  requestMode: string;
  autoTarget?: string;
  concurrency: number;
  now: () => Date;
  logger: Logger;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
  createRun: (mode: string) => Promise<DurableRunRecord>;
  discover: (run: DurableRunRecord) => Promise<DurableDiscovery>;
  processItem: (run: DurableRunRecord, item: DurableItem) => Promise<void>;
  advanceState?: (
    tx: TransactionDb,
    run: DurableRunRecord,
    finishedAt: Date,
  ) => Promise<void>;
};

type TransactionDb = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

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

export function validateHeartbeatIntervalMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Heartbeat interval must be a positive safe integer");
  }
  return value;
}

async function updateRunHeartbeat(
  db: PrismaClient,
  runId: string,
  now: () => Date,
  logger: Logger,
): Promise<void> {
  try {
    await db.syncRun.update({
      where: { id: runId },
      data: { lastHeartbeatAt: now() },
    });
  } catch (error) {
    // A failed heartbeat is itself the liveness signal; do not abort the run.
    logger.error(
      `Heartbeat update failed for sync run ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function startRunHeartbeat(
  options: Pick<DurableRunnerOptions, "db" | "now" | "logger">,
  runId: string,
  heartbeatIntervalMs: number,
): { stop(): void } {
  validateHeartbeatIntervalMs(heartbeatIntervalMs);
  const timer = setInterval(() => {
    void updateRunHeartbeat(options.db, runId, options.now, options.logger);
  }, heartbeatIntervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export async function runDurableSync(
  options: DurableRunnerOptions,
): Promise<DurableRunResult> {
  const heartbeatIntervalMs = validateHeartbeatIntervalMs(
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  throwIfVocaDbCancelled(options.signal);
  let run: DurableRunRecord;
  if (options.requestMode === "RESUME") {
    run = await getRunningRun(options.db, options.entity);
    await clearRunError(options.db, run.id);
  } else if (options.requestMode === "AUTO") {
    const running = await findRunningRuns(options.db, options.entity);
    if (running.length > 1) {
      throw new Error(
        `Multiple running ${options.entity.toLowerCase()} sync runs require operator intervention`,
      );
    }
    if (running.length === 1) {
      run = running[0];
      await clearRunError(options.db, run.id);
      options.logger.log(
        `Scheduled ${options.autoTarget} sync resumes ${run.mode} run ${run.id}`,
      );
    } else {
      run = await options.createRun(options.autoTarget!);
    }
  } else {
    await assertNoRunningRun(options.db, options.entity);
    run = await options.createRun(options.requestMode);
  }

  // Establish an initial heartbeat before discovery, which may run long and
  // would otherwise appear unresponsive; resume clears the prior stale beat.
  await updateRunHeartbeat(options.db, run.id, options.now, options.logger);
  const heartbeat = startRunHeartbeat(options, run.id, heartbeatIntervalMs);

  try {
    throwIfVocaDbCancelled(options.signal);
    if (!run.discoveryCompletedAt) {
      const discovery = await options.discover(run);
      throwIfVocaDbCancelled(options.signal);
      const completedAt = options.now();
      await persistManifest(options.db, run.id, discovery, completedAt);
      run = { ...run, discoveryCompletedAt: completedAt };
    }

    await processPendingItems(run, options);
    throwIfVocaDbCancelled(options.signal);
    heartbeat.stop();
    return await finalizeRun(
      options.db,
      run,
      options.now(),
      options.advanceState,
      options.signal,
    );
  } catch (error) {
    await recordRunInterruption(options.db, run.id, error);
    throw error;
  } finally {
    heartbeat.stop();
  }
}

export async function createIdsRun(
  db: PrismaClient,
  entity: Entity,
  ids: number[],
  now: Date,
): Promise<DurableRunRecord> {
  const normalized = normalizeIds(ids);
  return db.syncRun.create({
    data: {
      entity,
      mode: "IDS",
      requestedCount: normalized.length,
      sourceIdCount: normalized.length,
      sourceIdDigest: digestIds(normalized),
      discoveryCompletedAt: now,
      items: { create: normalized.map((vocadbId) => ({ vocadbId })) },
    },
    select: runSelect,
  });
}

export async function findRunningRuns(
  db: PrismaClient,
  entity: Entity,
): Promise<DurableRunRecord[]> {
  return db.syncRun.findMany({
    where: { entity, status: SyncRunStatus.RUNNING },
    orderBy: { sequence: "asc" },
    take: 2,
    select: runSelect,
  });
}

export async function persistManifest(
  db: PrismaClient,
  runId: string,
  discovery: DurableDiscovery,
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

export async function beginItem(
  db: PrismaClient,
  itemId: string,
  startedAt: Date,
): Promise<void> {
  await db.syncItem.update({
    where: { id: itemId },
    data: {
      startedAt: { set: startedAt },
      lastAttemptAt: startedAt,
      attemptCount: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    },
  });
}

export async function finishItem(
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

export async function failItem(
  db: PrismaClient,
  itemId: string,
  error: unknown,
  finishedAt: Date,
): Promise<{ code: string; message: string; sourceMissing: boolean }> {
  const details = safeError(error);
  await db.syncItem.update({
    where: { id: itemId },
    data: {
      status: SyncStatus.FAILED,
      errorCode: details.code,
      errorMessage: details.message,
      finishedAt,
    },
  });
  return details;
}

export function safeError(error: unknown): {
  code: string;
  message: string;
  sourceMissing: boolean;
} {
  if (error instanceof VocaDbError) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      sourceMissing: error.code === "NOT_FOUND",
    };
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    sourceMissing: false,
  };
}

async function getRunningRun(
  db: PrismaClient,
  entity: Entity,
): Promise<DurableRunRecord> {
  const runs = await findRunningRuns(db, entity);
  if (runs.length !== 1) {
    throw new Error(
      runs.length === 0
        ? `No running ${entity.toLowerCase()} sync run to resume`
        : `Multiple running ${entity.toLowerCase()} sync runs require operator intervention`,
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

async function assertNoRunningRun(
  db: PrismaClient,
  entity: Entity,
): Promise<void> {
  if ((await findRunningRuns(db, entity)).length > 0) {
    throw new Error(
      `A ${entity.toLowerCase()} sync run is already running; use resume`,
    );
  }
}

async function processPendingItems(
  run: DurableRunRecord,
  options: DurableRunnerOptions,
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
    { length: Math.min(options.concurrency, items.length) },
    async () => {
      while (!stopped && nextIndex < items.length) {
        try {
          throwIfVocaDbCancelled(options.signal);
          const item = items[nextIndex++];
          await options.processItem(run, item);
        } catch (error) {
          if (isVocaDbCancellation(error, options.signal)) {
            firstError ??= error instanceof VocaDbCancellationError
              ? error
              : new VocaDbCancellationError(options.signal?.reason);
          } else {
            firstError ??= error;
          }
          stopped = true;
        }
      }
    },
  );
  await Promise.allSettled(lanes);
  if (firstError !== undefined) throw firstError;
}

async function finalizeRun(
  db: PrismaClient,
  run: DurableRunRecord,
  finishedAt: Date,
  advanceState: DurableRunnerOptions["advanceState"],
  signal?: AbortSignal,
): Promise<DurableRunResult> {
  throwIfVocaDbCancelled(signal);
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
        status: { in: [SyncStatus.SYNCED, SyncStatus.SOURCE_DELETED] },
      },
    }),
  ]);
  const status = failureCount === 0
    ? SyncRunStatus.SUCCEEDED
    : successCount === 0
      ? SyncRunStatus.FAILED
      : SyncRunStatus.PARTIAL;

  throwIfVocaDbCancelled(signal);
  await db.$transaction(async (tx) => {
    throwIfVocaDbCancelled(signal);
    if (failureCount === 0 && advanceState) {
      await advanceState(tx, run, finishedAt);
    }
    throwIfVocaDbCancelled(signal);
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

async function recordRunInterruption(
  db: PrismaClient,
  runId: string,
  error: unknown,
): Promise<void> {
  const details = safeRunError(error);
  await db.syncRun.updateMany({
    where: { id: runId, status: SyncRunStatus.RUNNING },
    data: { errorCode: details.code, errorMessage: details.message },
  });
}

function safeRunError(error: unknown): { code: string; message: string } {
  if (error instanceof VocaDbError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  const withCode = error as { code?: unknown };
  return {
    code: typeof withCode?.code === "string" ? withCode.code : "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
  };
}

export function digestIds(ids: number[]): string {
  return createHash("sha256")
    .update(normalizeIds(ids, true).join(","))
    .digest("hex");
}

export function normalizeIds(
  ids: number[],
  allowEmpty = false,
  label = "Source IDs",
): number[] {
  if (
    (!allowEmpty && ids.length === 0) ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new TypeError(`${label} must contain positive safe integers`);
  }
  return [...new Set(ids)].sort((left, right) => left - right);
}
