import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  SyncEntity,
  SyncRunMode,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";
import { getOperationsStatus } from "@/lib/operations/status-repository";
import { VOCADB_SONG_SYNC_STATE_ID } from "@/lib/vocadb/sync-runner";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const now = new Date("2026-08-09T12:00:00.000Z");
const staleAfterMs = 60 * 60 * 1_000;

beforeAll(async () => db.$connect());
beforeEach(async () => {
  await db.vocaDbSongSyncState.deleteMany();
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
});

async function seedFreshSongState() {
  await db.vocaDbSongSyncState.create({
    data: {
      id: VOCADB_SONG_SYNC_STATE_ID,
      activityCheckpoint: new Date(now.getTime() - staleAfterMs + 1),
      lastSeedCompletedAt: new Date(now.getTime() - staleAfterMs + 1),
      lastReconciledAt: now,
    },
  });
}

describe("operations status repository", () => {
  it("reports an unseeded catalog without a sync state", async () => {
    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({
        classification: "UNSEEDED",
        songs: {
          activityCheckpoint: null,
          lastSeedCompletedAt: null,
          latestRun: null,
          runningManifestCount: 0,
        },
        artists: { latestRun: null, runningManifestCount: 0 },
        resumableManifests: [],
      });
  });

  it("reports a fresh seeded catalog as ready with SONG and ARTIST summaries", async () => {
    await seedFreshSongState();
    const songRun = await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.INCREMENTAL,
        status: SyncRunStatus.SUCCEEDED,
        requestedCount: 2,
        successCount: 2,
        finishedAt: now,
        items: {
          create: [
            { vocadbId: 1, status: SyncStatus.SYNCED, finishedAt: now },
            {
              vocadbId: 2,
              status: SyncStatus.SOURCE_DELETED,
              finishedAt: now,
            },
          ],
        },
      },
    });
    await db.syncRun.create({
      data: {
        entity: SyncEntity.ARTIST,
        mode: SyncRunMode.REFRESH,
        status: SyncRunStatus.SUCCEEDED,
        requestedCount: 1,
        successCount: 1,
        finishedAt: now,
        items: {
          create: [{ vocadbId: 100, status: SyncStatus.SYNCED, finishedAt: now }],
        },
      },
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({
        classification: "READY",
        songs: {
          latestRun: {
            mode: "INCREMENTAL",
            status: "SUCCEEDED",
            requestedCount: 2,
            successCount: 2,
            itemCounts: {
              PENDING: 0,
              SYNCED: 1,
              FAILED: 0,
              SOURCE_MISSING: 0,
              SOURCE_DELETED: 1,
            },
          },
        },
        artists: {
          latestRun: {
            mode: "REFRESH",
            status: "SUCCEEDED",
            itemCounts: {
              PENDING: 0,
              SYNCED: 1,
              FAILED: 0,
              SOURCE_MISSING: 0,
              SOURCE_DELETED: 0,
            },
          },
        },
      });
    expect(songRun.id).toBeTruthy();
  });

  it("reports a seeded catalog with an expired checkpoint as stale", async () => {
    await db.vocaDbSongSyncState.create({
      data: {
        id: VOCADB_SONG_SYNC_STATE_ID,
        activityCheckpoint: new Date(now.getTime() - staleAfterMs),
        lastSeedCompletedAt: new Date(now.getTime() - staleAfterMs),
      },
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({ classification: "STALE" });
  });

  it("reports a latest terminal failure as degraded", async () => {
    await seedFreshSongState();
    await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.INCREMENTAL,
        status: SyncRunStatus.FAILED,
        failureCount: 1,
        errorCode: "UPSTREAM_FAILED",
        errorMessage: "private upstream error",
        finishedAt: now,
        items: {
          create: [{
            vocadbId: 12345,
            status: SyncStatus.FAILED,
            errorCode: "UPSTREAM_FAILED",
            errorMessage: "private item error",
            finishedAt: now,
          }],
        },
      },
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({ classification: "DEGRADED" });
  });

  it("reports multiple running manifests for one entity as degraded", async () => {
    await seedFreshSongState();
    await db.syncRun.createMany({
      data: [
        { entity: SyncEntity.ARTIST, mode: SyncRunMode.REFRESH },
        { entity: SyncEntity.ARTIST, mode: SyncRunMode.REFRESH },
      ],
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });

    expect(status.classification).toBe("DEGRADED");
    expect(status.artists.runningManifestCount).toBe(2);
    expect(status.resumableManifests).toHaveLength(2);
    expect(status.resumableManifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: "ARTIST", status: "RUNNING" }),
      ]),
    );
  });

  it("redacts run and item identifiers, source data, and error text", async () => {
    await seedFreshSongState();
    const run = await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.IDS,
        sourceIdCount: 1,
        sourceIdDigest: "private-source-digest",
        errorCode: "PRIVATE_RUN_CODE",
        errorMessage: "private run error message",
        items: {
          create: [{
            vocadbId: 987654,
            status: SyncStatus.PENDING,
            errorCode: "PRIVATE_ITEM_CODE",
            errorMessage: "private item error message",
          }],
        },
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });
    const serialized = JSON.stringify(status);

    expect(status.resumableManifests).toEqual([
      expect.objectContaining({
        entity: "SONG",
        mode: "IDS",
        status: "RUNNING",
        sequence: run.sequence.toString(),
        pendingItemCount: 1,
      }),
    ]);
    expect(serialized).not.toContain(run.id);
    expect(serialized).not.toContain("987654");
    expect(serialized).not.toContain("private-source-digest");
    expect(serialized).not.toContain("PRIVATE_RUN_CODE");
    expect(serialized).not.toContain("private run error message");
    expect(serialized).not.toContain("PRIVATE_ITEM_CODE");
    expect(serialized).not.toContain("private item error message");
  });

  it("reports a RUNNING manifest with a fresh heartbeat as ready", async () => {
    await seedFreshSongState();
    const freshHeartbeat = new Date(now.getTime() - 60_000);
    await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.INCREMENTAL,
        lastHeartbeatAt: freshHeartbeat,
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });

    expect(status.classification).toBe("READY");
    expect(status.resumableManifests).toHaveLength(1);
    expect(status.resumableManifests[0]).toMatchObject({
      entity: "SONG",
      status: "RUNNING",
      lastHeartbeatAt: freshHeartbeat.toISOString(),
      heartbeatStale: false,
    });
  });

  it("reports a RUNNING manifest with a stale heartbeat as degraded", async () => {
    await seedFreshSongState();
    await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.INCREMENTAL,
        lastHeartbeatAt: new Date(now.getTime() - 10 * 60 * 1_000),
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });

    expect(status.classification).toBe("DEGRADED");
    expect(status.resumableManifests[0].heartbeatStale).toBe(true);
  });

  it("reports a RUNNING manifest without a heartbeat as degraded", async () => {
    await seedFreshSongState();
    await db.syncRun.create({
      data: { entity: SyncEntity.SONG, mode: SyncRunMode.INCREMENTAL },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });

    expect(status.classification).toBe("DEGRADED");
    expect(status.resumableManifests[0]).toMatchObject({
      lastHeartbeatAt: null,
      heartbeatStale: true,
    });
  });

  it("honors a custom heartbeat staleness window", async () => {
    await seedFreshSongState();
    await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: SyncRunMode.INCREMENTAL,
        lastHeartbeatAt: new Date(now.getTime() - 10 * 60 * 1_000),
      },
    });

    const status = await getOperationsStatus(db, {
      now: () => now,
      staleAfterMs,
      heartbeatStaleAfterMs: 20 * 60 * 1_000,
    });

    expect(status.classification).toBe("READY");
    expect(status.resumableManifests[0].heartbeatStale).toBe(false);
  });
});
