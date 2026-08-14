import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  DiscoverySnapshotStatus,
  SyncEntity,
  SyncRunMode,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";
import { getDiscoveryMaterializerTiming } from "@/lib/discover/materializer-timing";
import { DISCOVERY_CATALOG_STATE_ID } from "@/lib/discover/stale-candidates";
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
  await db.discoverySnapshotItem.deleteMany();
  await db.discoveryProfile.deleteMany();
  await db.discoverySnapshot.deleteMany();
  await db.discoveryCatalogState.deleteMany();
  await db.playlistCollaborator.deleteMany();
  await db.playlistSong.deleteMany();
  await db.favorite.deleteMany();
  await db.playlist.deleteMany();
  await db.user.deleteMany();
  await db.song.deleteMany();
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

async function discoveryUser(email: string) {
  return db.user.create({ data: { email } });
}

async function discoverySong(vocadbId: number) {
  return db.song.create({
    data: {
      vocadbId,
      name: `Discovery ${vocadbId}`,
      defaultName: `Discovery ${vocadbId}`,
      defaultNameLanguage: "English",
      artistString: "Artist",
      songType: "Original",
      sourceStatus: "Finished",
      sourceCreatedAt: now,
      durationSeconds: 180,
      favoritedTimes: 0,
      ratingScore: 0,
      cultureCodes: [],
      sourceVersion: 1,
      lastSyncedAt: now,
      syncStatus: SyncStatus.SYNCED,
    },
  });
}

describe("operations status repository", () => {
  it("reports profile-less favorite and playlist candidates without private data", async () => {
    await seedFreshSongState();
    const favoriteUser = await discoveryUser("favorite-candidate@example.com");
    const owner = await discoveryUser("playlist-owner-candidate@example.com");
    const collaborator = await discoveryUser("playlist-collaborator-candidate@example.com");
    const ignoredOwner = await discoveryUser("empty-playlist@example.com");
    const song = await discoverySong(90_001);
    const ownerPlaylist = await db.playlist.create({
      data: { userId: owner.id, name: "Owner playlist" },
    });
    const collaboratorPlaylist = await db.playlist.create({
      data: { userId: owner.id, name: "Collaborator playlist" },
    });
    await db.playlist.create({ data: { userId: ignoredOwner.id, name: "Empty" } });
    await db.favorite.create({ data: { userId: favoriteUser.id, songId: song.id } });
    await db.playlistSong.createMany({
      data: [
        { playlistId: ownerPlaylist.id, songId: song.id, position: 0 },
        { playlistId: collaboratorPlaylist.id, songId: song.id, position: 0 },
      ],
    });
    await db.playlistCollaborator.create({
      data: { playlistId: collaboratorPlaylist.id, userId: collaborator.id },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });
    const serialized = JSON.stringify(status);

    expect(status.classification).toBe("READY");
    expect(status.discovery).toEqual({
      snapshotReadsEnabled: false,
      catalogVersion: 0,
      freshProfileCount: 0,
      staleProfileCount: 3,
      unprovisionedCandidateCount: 3,
      activeBuildCount: 0,
      failedProfileCount: 0,
      oldestPendingAt: null,
    });
    for (const value of [
      favoriteUser.id,
      owner.id,
      collaborator.id,
      song.id,
      ownerPlaylist.id,
      collaboratorPlaylist.id,
    ]) expect(serialized).not.toContain(value);
  });

  it("deduplicates candidate sources and excludes fresh snapshots", async () => {
    await seedFreshSongState();
    const viewer = await discoveryUser("deduplicated-candidate@example.com");
    const freshViewer = await discoveryUser("fresh-candidate@example.com");
    const firstSong = await discoverySong(90_002);
    const secondSong = await discoverySong(90_003);
    const playlist = await db.playlist.create({ data: { userId: viewer.id, name: "Mixed" } });
    const freshPlaylist = await db.playlist.create({ data: { userId: freshViewer.id, name: "Fresh" } });
    await db.favorite.createMany({
      data: [
        { userId: viewer.id, songId: firstSong.id },
        { userId: viewer.id, songId: secondSong.id },
        { userId: freshViewer.id, songId: firstSong.id },
      ],
    });
    await db.playlistSong.createMany({
      data: [
        { playlistId: playlist.id, songId: firstSong.id, position: 0 },
        { playlistId: freshPlaylist.id, songId: secondSong.id, position: 0 },
      ],
    });
    await db.playlistCollaborator.create({ data: { playlistId: playlist.id, userId: viewer.id } });
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: freshViewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: DiscoverySnapshotStatus.READY,
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: freshViewer.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        currentSnapshotId: snapshot.id,
      },
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({
        classification: "READY",
        discovery: {
          staleProfileCount: 1,
          failedProfileCount: 0,
          oldestPendingAt: null,
        },
      });
  });

  it("excludes active discovery leases and restores expired profiles to queue", async () => {
    await seedFreshSongState();
    const active = await discoveryUser("active-discovery-lease@example.com");
    const expired = await discoveryUser("expired-discovery-lease@example.com");
    const { buildLeaseMs } = getDiscoveryMaterializerTiming();
    const expiredPendingAt = new Date(now.getTime() - buildLeaseMs - 2 * 60_000);
    await db.discoveryProfile.createMany({
      data: [
        {
          userId: active.id,
          refreshStartedAt: new Date(now.getTime() - buildLeaseMs + 60_000),
          updatedAt: new Date(now.getTime() - buildLeaseMs - 3 * 60_000),
        },
        {
          userId: expired.id,
          refreshStartedAt: new Date(now.getTime() - buildLeaseMs - 60_000),
          updatedAt: expiredPendingAt,
        },
      ],
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({
        classification: "READY",
        discovery: {
          staleProfileCount: 1,
          failedProfileCount: 0,
          oldestPendingAt: expiredPendingAt.toISOString(),
        },
      });
  });

  it("reports aggregate snapshot rollout coverage without exposing identities", async () => {
    await seedFreshSongState();
    await db.discoveryCatalogState.create({
      data: { id: DISCOVERY_CATALOG_STATE_ID, version: 1 },
    });

    const freshUser = await discoveryUser("fresh-rollout@example.com");
    const staleUser = await discoveryUser("stale-rollout@example.com");
    const candidateUser = await discoveryUser("candidate-rollout@example.com");
    const activeUser = await discoveryUser("active-rollout@example.com");
    const song = await discoverySong(90_010);

    const freshSnapshot = await db.discoverySnapshot.create({
      data: {
        userId: freshUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: DiscoverySnapshotStatus.READY,
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: freshUser.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        currentSnapshotId: freshSnapshot.id,
      },
    });

    const staleSnapshot = await db.discoverySnapshot.create({
      data: {
        userId: staleUser.id,
        libraryVersion: 1,
        catalogVersion: 0,
        status: DiscoverySnapshotStatus.READY,
      },
    });
    const expectedPendingAt = new Date("2026-08-09T10:00:00.000Z");
    await db.discoveryProfile.create({
      data: {
        userId: staleUser.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        currentSnapshotId: staleSnapshot.id,
        updatedAt: expectedPendingAt,
      },
    });

    await db.favorite.create({
      data: { userId: candidateUser.id, songId: song.id },
    });

    const { buildLeaseMs } = getDiscoveryMaterializerTiming();
    await db.discoveryProfile.create({
      data: {
        userId: activeUser.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        refreshStartedAt: new Date(now.getTime() - buildLeaseMs + 60_000),
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });
    const serialized = JSON.stringify(status);

    expect(status.classification).toBe("READY");
    expect(status.discovery).toEqual({
      snapshotReadsEnabled: false,
      catalogVersion: 1,
      freshProfileCount: 1,
      staleProfileCount: 2,
      unprovisionedCandidateCount: 1,
      activeBuildCount: 1,
      failedProfileCount: 0,
      oldestPendingAt: expectedPendingAt.toISOString(),
    });
    for (const value of [
      freshUser.id,
      staleUser.id,
      candidateUser.id,
      activeUser.id,
      song.id,
      freshSnapshot.id,
      staleSnapshot.id,
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("reports stale discovery profiles without degrading an otherwise ready catalog", async () => {
    await seedFreshSongState();
    const viewer = await discoveryUser("stale-discovery@example.com");
    const oldestPendingAt = new Date("2026-08-09T10:00:00.000Z");
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        updatedAt: oldestPendingAt,
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });

    expect(status.classification).toBe("READY");
    expect(status.discovery).toEqual({
      snapshotReadsEnabled: false,
      catalogVersion: 0,
      freshProfileCount: 0,
      staleProfileCount: 1,
      unprovisionedCandidateCount: 0,
      activeBuildCount: 0,
      failedProfileCount: 0,
      oldestPendingAt: oldestPendingAt.toISOString(),
    });
  });

  it("queues version-mismatched ready snapshots", async () => {
    await seedFreshSongState();
    const viewer = await discoveryUser("versioned-discovery@example.com");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: DiscoverySnapshotStatus.READY,
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        currentSnapshotId: snapshot.id,
      },
    });

    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({ discovery: { staleProfileCount: 0 } });

    await db.discoveryProfile.update({
      where: { userId: viewer.id },
      data: { libraryVersion: 2 },
    });
    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({ discovery: { staleProfileCount: 1 } });

    await db.discoveryProfile.update({
      where: { userId: viewer.id },
      data: { libraryVersion: 1 },
    });
    await db.discoveryCatalogState.create({
      data: { id: DISCOVERY_CATALOG_STATE_ID, version: 2 },
    });
    await expect(getOperationsStatus(db, { now: () => now, staleAfterMs })).resolves
      .toMatchObject({ discovery: { staleProfileCount: 1 } });
  });

  it("reports discovery refresh failures as degraded without exposing private data", async () => {
    await seedFreshSongState();
    const viewer = await discoveryUser("failed-discovery@example.com");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: DiscoverySnapshotStatus.READY,
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        requiredCatalogVersion: 1,
        currentSnapshotId: snapshot.id,
        lastRefreshError: "private discovery failure",
      },
    });

    const status = await getOperationsStatus(db, { now: () => now, staleAfterMs });
    const serialized = JSON.stringify(status);

    expect(status.classification).toBe("DEGRADED");
    expect(status.discovery).toEqual({
      snapshotReadsEnabled: false,
      catalogVersion: 0,
      freshProfileCount: 1,
      staleProfileCount: 0,
      unprovisionedCandidateCount: 0,
      activeBuildCount: 0,
      failedProfileCount: 1,
      oldestPendingAt: null,
    });
    expect(serialized).not.toContain(viewer.id);
    expect(serialized).not.toContain(snapshot.id);
    expect(serialized).not.toContain("private discovery failure");
  });

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
        discovery: {
          staleProfileCount: 0,
          failedProfileCount: 0,
          oldestPendingAt: null,
        },
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
