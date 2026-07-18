import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncRunMode, SyncStatus } from "@/generated/prisma/enums";
import { VocaDbNotFoundError } from "@/lib/vocadb/errors";
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

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await db.vocaDbSongSyncState.deleteMany();
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

function source(id: number, overrides: Record<string, unknown> = {}) {
  return vocaDbSongSchema.parse(
    structuredClone({ ...vocaDbSongFixture, id, ...overrides }),
  );
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
});
