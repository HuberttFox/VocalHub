import "dotenv/config";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncRunMode, SyncRunStatus, SyncStatus } from "@/generated/prisma/enums";
import { VocaDbCancellationError, VocaDbNotFoundError } from "@/lib/vocadb/errors";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import {
  runVocaDbSongSync,
  VOCADB_SONG_SYNC_STATE_ID,
} from "@/lib/vocadb/sync-runner";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const quietLogger = { log() {}, error() {} };
const initialBatchBudget = process.env.DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS;

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await db.discoverySnapshotItem.deleteMany();
  await db.discoveryProfile.deleteMany();
  await db.discoverySnapshot.deleteMany();
  await db.discoveryCatalogState.deleteMany();
  await db.vocaDbSongSyncState.deleteMany();
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.artistWebLink.deleteMany();
  await db.artistName.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.user.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});
afterEach(() => {
  if (initialBatchBudget === undefined) delete process.env.DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS;
  else process.env.DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS = initialBatchBudget;
});

function source(id: number, overrides: Record<string, unknown> = {}) {
  return vocaDbSongSchema.parse(
    structuredClone({ ...vocaDbSongFixture, id, ...overrides }),
  );
}

async function staleDiscoveryProfile() {
  const user = await db.user.create({ data: {} });
  await db.discoveryProfile.create({ data: { userId: user.id } });
  return user;
}

describe("durable VocaDB sync runner", () => {
  it("seeds a durable manifest and establishes the activity checkpoint", async () => {
    const baseline = new Date("2026-07-18T01:00:00Z");
    const client = {
      getSongIds: async () => [2, 1],
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => source(id),
    };

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      { db, client, now: () => baseline, logger: quietLogger },
    );

    expect(result).toMatchObject({ successCount: 2, failureCount: 0 });
    expect(await db.song.count()).toBe(2);
    const run = await db.syncRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { items: { orderBy: { vocadbId: "asc" } } },
    });
    expect(run.items.map((item) => item.vocadbId)).toEqual([1, 2]);
    expect(run.sourceIdCount).toBe(2);
    expect(run.sourceIdDigest).toHaveLength(64);
    expect(run.discoveryCompletedAt).not.toBeNull();

    const state = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(state.activityCheckpoint?.toISOString()).toBe(
      baseline.toISOString(),
    );
    expect(state.lastSeedCompletedAt).not.toBeNull();
    expect(state.version).toBe(1);
  });

  it("increments discovery catalog once for multiple song mutations", async () => {
    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1, 2],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );

    expect(result.status).toBe(SyncRunStatus.SUCCEEDED);
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      db.syncRun.findUniqueOrThrow({ where: { id: result.runId } }),
    ).resolves.toMatchObject({ catalogChanged: false });
  });

  it("does not increment discovery catalog for an empty reconciliation", async () => {
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );
    const before = await db.discoveryCatalogState.findUniqueOrThrow({
      where: { id: "catalog" },
    });

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.RECONCILE },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new Error("no candidate details should be fetched");
          },
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({ status: SyncRunStatus.SUCCEEDED, successCount: 0 });
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: before.version });
  });

  it("advances discovery catalog after cancellation with committed song mutations", async () => {
    const controller = new AbortController();
    let requested = 0;

    await expect(
      runVocaDbSongSync(
        { mode: SyncRunMode.SEED },
        {
          db,
          concurrency: 1,
          signal: controller.signal,
          logger: quietLogger,
          client: {
            getSongIds: async () => [1, 2],
            getSongActivityEntries: async () => [],
            getSong: async (id: number) => {
              requested += 1;
              if (requested === 2) controller.abort();
              return source(id);
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(VocaDbCancellationError);

    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      db.syncRun.findFirstOrThrow(),
    ).resolves.toMatchObject({ catalogChanged: false });
  });

  it("keeps a completed sync successful when materializer timing is invalid", async () => {
    await staleDiscoveryProfile();
    process.env.DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS = "invalid";
    const errors: string[] = [];

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: { log() {}, error(message: string) { errors.push(message); } },
      },
    );

    expect(result.status).toBe(SyncRunStatus.SUCCEEDED);
    expect(errors).toEqual([
      expect.stringContaining("DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS"),
    ]);
    expect(await db.discoverySnapshot.count()).toBe(0);
  });

  it("materializes stale profiles after a successful catalog-changing run", async () => {
    const user = await staleDiscoveryProfile();

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );

    expect(result.status).toBe(SyncRunStatus.SUCCEEDED);
    expect(
      await db.discoverySnapshot.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it("materializes stale profiles after a partial catalog-changing run", async () => {
    const user = await staleDiscoveryProfile();

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1, 2],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => {
            if (id === 2) throw new Error("upstream failed");
            return source(id);
          },
        },
        logger: quietLogger,
      },
    );

    expect(result.status).toBe(SyncRunStatus.PARTIAL);
    expect(
      await db.discoverySnapshot.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it("does not materialize stale profiles after a failed source-missing run", async () => {
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );
    const user = await staleDiscoveryProfile();

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.IDS, ids: [1] },
      {
        db,
        client: {
          getSongIds: async () => [],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new VocaDbNotFoundError(1);
          },
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({
      status: SyncRunStatus.FAILED,
      catalogChanged: true,
    });
    expect(
      await db.discoverySnapshot.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("does not materialize stale profiles after cancellation", async () => {
    const user = await staleDiscoveryProfile();
    const controller = new AbortController();
    let requested = 0;

    await expect(
      runVocaDbSongSync(
        { mode: SyncRunMode.SEED },
        {
          db,
          concurrency: 1,
          signal: controller.signal,
          logger: quietLogger,
          client: {
            getSongIds: async () => [1, 2],
            getSongActivityEntries: async () => [],
            getSong: async (id: number) => {
              requested += 1;
              if (requested === 2) controller.abort();
              return source(id);
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(VocaDbCancellationError);

    expect(
      await db.discoverySnapshot.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("does not advance discovery catalog for a failed run that leaves a local song public", async () => {
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );
    const before = await db.discoveryCatalogState.findUniqueOrThrow({
      where: { id: "catalog" },
    });

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.IDS, ids: [1] },
      {
        db,
        client: {
          getSongIds: async () => [],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new Error("upstream failed");
          },
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({
      status: SyncRunStatus.FAILED,
      catalogChanged: false,
    });
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: before.version });
  });

  it("consumes a persisted catalog change when a resumed run has no pending items", async () => {
    const run = await db.syncRun.create({
      data: {
        mode: SyncRunMode.IDS,
        discoveryCompletedAt: new Date("2026-07-18T01:00:00Z"),
        catalogChanged: true,
        items: {
          create: [{
            vocadbId: 1,
            status: SyncStatus.SYNCED,
            finishedAt: new Date("2026-07-18T01:00:00Z"),
          }],
        },
      },
    });

    const result = await runVocaDbSongSync(
      { mode: "RESUME" },
      {
        db,
        client: {
          getSongIds: async () => {
            throw new Error("rediscovery should not run");
          },
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new Error("no pending item should fetch");
          },
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({ runId: run.id, catalogChanged: true });
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      db.syncRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ catalogChanged: false });
  });

  it("resumes pending manifest items without rediscovery", async () => {
    const run = await db.syncRun.create({
      data: {
        mode: SyncRunMode.IDS,
        discoveryCompletedAt: new Date("2026-07-18T01:00:00Z"),
        requestedCount: 2,
        items: {
          create: [
            {
              vocadbId: 1,
              status: SyncStatus.SYNCED,
              finishedAt: new Date("2026-07-18T01:00:00Z"),
            },
            { vocadbId: 2 },
          ],
        },
      },
    });
    const fetched: number[] = [];
    const client = {
      getSongIds: async () => {
        throw new Error("rediscovery should not run");
      },
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => {
        fetched.push(id);
        return source(id);
      },
    };

    const result = await runVocaDbSongSync(
      { mode: "RESUME" },
      { db, client, logger: quietLogger },
    );

    expect(result.runId).toBe(run.id);
    expect(fetched).toEqual([2]);
  });

  it("auto mode resumes a running manifest before its scheduled target", async () => {
    const run = await db.syncRun.create({
      data: {
        mode: SyncRunMode.IDS,
        discoveryCompletedAt: new Date("2026-07-18T01:00:00Z"),
        errorCode: "CANCELLED",
        errorMessage: "interrupted",
        items: { create: [{ vocadbId: 1 }] },
      },
    });

    const result = await runVocaDbSongSync(
      { mode: "AUTO", target: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => {
            throw new Error("scheduled discovery should not run");
          },
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );

    expect(result.runId).toBe(run.id);
    expect(await db.syncRun.count()).toBe(1);
    expect(
      await db.syncRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({
      status: "SUCCEEDED",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("cancellation leaves active items pending and checkpoint unchanged", async () => {
    const checkpoint = new Date("2026-07-17T00:00:00Z");
    await db.vocaDbSongSyncState.create({
      data: {
        id: VOCADB_SONG_SYNC_STATE_ID,
        version: 4,
        activityCheckpoint: checkpoint,
        lastSeedCompletedAt: checkpoint,
      },
    });
    const controller = new AbortController();
    let started = 0;
    const promise = runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        concurrency: 2,
        signal: controller.signal,
        logger: quietLogger,
        client: {
          getSongIds: async () => [1, 2, 3],
          getSongActivityEntries: async () => [],
          getSong: async (_id: number, options?: { signal?: AbortSignal }) => {
            started += 1;
            if (started === 2) controller.abort();
            if (options?.signal?.aborted) throw new VocaDbCancellationError();
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (options?.signal?.aborted) throw new VocaDbCancellationError();
            return source(1);
          },
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(VocaDbCancellationError);
    expect(started).toBe(2);
    const run = await db.syncRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "RUNNING", errorCode: "CANCELLED" });
    expect(
      await db.syncItem.count({ where: { status: SyncStatus.PENDING } }),
    ).toBe(3);
    const state = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(state.version).toBe(4);
    expect(state.activityCheckpoint).toEqual(checkpoint);
  });

  it("does not advance checkpoints for legacy SOURCE_MISSING items", async () => {
    const checkpoint = new Date("2026-07-17T00:00:00Z");
    await db.vocaDbSongSyncState.create({
      data: {
        id: VOCADB_SONG_SYNC_STATE_ID,
        version: 7,
        activityCheckpoint: checkpoint,
        lastSeedCompletedAt: checkpoint,
      },
    });
    const run = await db.syncRun.create({
      data: {
        mode: SyncRunMode.SEED,
        discoveryCompletedAt: checkpoint,
        baselineAt: checkpoint,
        expectedStateVersion: 7,
        items: {
          create: [{ vocadbId: 1, status: SyncStatus.SOURCE_MISSING }],
        },
      },
    });

    const result = await runVocaDbSongSync(
      { mode: "RESUME" },
      {
        db,
        client: {
          getSongIds: async () => [],
          getSongActivityEntries: async () => [],
          getSong: async () => source(1),
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({ runId: run.id, failureCount: 1 });
    const state = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(state.version).toBe(7);
    expect(state.activityCheckpoint).toEqual(checkpoint);
  });

  it("does not advance the seed checkpoint when an item fails", async () => {
    const checkpoint = new Date("2026-07-17T00:00:00Z");
    await db.vocaDbSongSyncState.create({
      data: {
        id: VOCADB_SONG_SYNC_STATE_ID,
        version: 3,
        activityCheckpoint: checkpoint,
        lastSeedCompletedAt: checkpoint,
      },
    });
    const client = {
      getSongIds: async () => [1, 2],
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => {
        if (id === 2) throw new Error("network exhausted");
        return source(id);
      },
    };

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      { db, client, logger: quietLogger },
    );

    expect(result.failureCount).toBe(1);
    const state = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(state.version).toBe(3);
    expect(state.activityCheckpoint?.toISOString()).toBe(
      checkpoint.toISOString(),
    );
  });

  it("does not advance the seed checkpoint when detail returns 404", async () => {
    const checkpoint = new Date("2026-07-17T00:00:00Z");
    await db.vocaDbSongSyncState.create({
      data: {
        id: VOCADB_SONG_SYNC_STATE_ID,
        version: 2,
        activityCheckpoint: checkpoint,
        lastSeedCompletedAt: checkpoint,
      },
    });

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new VocaDbNotFoundError(1);
          },
        },
        logger: quietLogger,
      },
    );

    expect(result.failureCount).toBe(1);
    const item = await db.syncItem.findFirstOrThrow();
    expect(item.status).toBe(SyncStatus.FAILED);
    expect(item.errorCode).toBe("NOT_FOUND");
    const state = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(state.version).toBe(2);
    expect(state.activityCheckpoint?.toISOString()).toBe(
      checkpoint.toISOString(),
    );
  });

  it("completes reconciliation when inventory has no deletion candidates", async () => {
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.RECONCILE },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new Error("no candidate details should be fetched");
          },
        },
        logger: quietLogger,
      },
    );

    expect(result).toMatchObject({ successCount: 0, failureCount: 0 });
    expect(result.status).toBe("SUCCEEDED");
  });

  it("reconciles inventory absence plus detail 404 as source deletion", async () => {
    const seedClient = {
      getSongIds: async () => [1],
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => source(id),
    };
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      { db, client: seedClient, logger: quietLogger },
    );
    const before = await db.discoveryCatalogState.findUniqueOrThrow({
      where: { id: "catalog" },
    });

    const reconcileClient = {
      getSongIds: async () => [2],
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => {
        throw new VocaDbNotFoundError(id);
      },
    };
    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.RECONCILE },
      { db, client: reconcileClient, logger: quietLogger },
    );

    expect(result.failureCount).toBe(0);
    expect(result.catalogChanged).toBe(true);
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: before.version + 1 });
    expect(
      await db.song.findUniqueOrThrow({ where: { vocadbId: 1 } }),
    ).toMatchObject({
      sourceDeleted: true,
      syncStatus: SyncStatus.SOURCE_DELETED,
    });
  });

  it("keeps contradictory inventory-present 404 as missing without advancing reconciliation", async () => {
    await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async (id: number) => source(id),
        },
        logger: quietLogger,
      },
    );
    await db.song.update({
      where: { vocadbId: 1 },
      data: { syncStatus: SyncStatus.SOURCE_MISSING },
    });
    const catalogBefore = await db.discoveryCatalogState.findUniqueOrThrow({
      where: { id: "catalog" },
    });
    const previousState = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.RECONCILE },
      {
        db,
        client: {
          getSongIds: async () => [1],
          getSongActivityEntries: async () => [],
          getSong: async () => {
            throw new VocaDbNotFoundError(1);
          },
        },
        logger: quietLogger,
      },
    );

    expect(result.failureCount).toBe(1);
    expect(result.catalogChanged).toBe(false);
    await expect(
      db.discoveryCatalogState.findUniqueOrThrow({ where: { id: "catalog" } }),
    ).resolves.toMatchObject({ version: catalogBefore.version });
    expect(
      await db.song.findUniqueOrThrow({ where: { vocadbId: 1 } }),
    ).toMatchObject({ sourceDeleted: false, syncStatus: SyncStatus.SOURCE_MISSING });
    const currentState = await db.vocaDbSongSyncState.findUniqueOrThrow({
      where: { id: VOCADB_SONG_SYNC_STATE_ID },
    });
    expect(currentState.lastReconciledAt).toEqual(
      previousState.lastReconciledAt,
    );
  });

  it("writes heartbeats during processing and finalizes succeeded", async () => {
    const client = {
      getSongIds: async () => [1, 2, 3],
      getSongActivityEntries: async () => [],
      getSong: async (id: number) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return source(id);
      },
    };

    const result = await runVocaDbSongSync(
      { mode: SyncRunMode.SEED },
      {
        db,
        client,
        now: () => new Date(),
        logger: quietLogger,
        heartbeatIntervalMs: 30,
      },
    );

    expect(result).toMatchObject({
      status: SyncRunStatus.SUCCEEDED,
      successCount: 3,
      failureCount: 0,
    });
    const run = await db.syncRun.findUniqueOrThrow({
      where: { id: result.runId },
    });
    expect(run.lastHeartbeatAt).not.toBeNull();
    expect(run.lastHeartbeatAt!.getTime()).toBeGreaterThan(
      run.startedAt.getTime(),
    );
  });
});
