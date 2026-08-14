import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PlaylistVisibility, SyncStatus } from "@/generated/prisma/enums";
import { DISCOVERY_ALGORITHM_VERSION } from "@/lib/discover/dto";
import {
  invalidateDiscoveryCatalog,
  materializeDiscoverySnapshots,
} from "@/lib/discover/materializer";
import { deleteExpiredDiscoverySnapshots } from "@/lib/discover/snapshot-cleanup";
import { getDiscovery } from "@/lib/discover/repository";
import { setFavorite } from "@/lib/favorites/repository";

const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const initialSnapshotReadsEnabled = process.env.DISCOVERY_SNAPSHOT_READS_ENABLED;

beforeAll(async () => db.$connect());
beforeEach(async () => {
  await db.discoverySnapshotItem.deleteMany();
  await db.discoveryProfile.deleteMany();
  await db.discoverySnapshot.deleteMany();
  await db.discoveryCatalogState.deleteMany();
  await db.playlistReport.deleteMany();
  await db.playlistCollaborator.deleteMany();
  await db.playlistSong.deleteMany();
  await db.favorite.deleteMany();
  await db.playlist.deleteMany();
  await db.songTag.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.tag.deleteMany();
  await db.artist.deleteMany();
  await db.user.deleteMany();
  await db.song.deleteMany();
});
afterEach(() => {
  if (initialSnapshotReadsEnabled === undefined) delete process.env.DISCOVERY_SNAPSHOT_READS_ENABLED;
  else process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = initialSnapshotReadsEnabled;
});
afterAll(async () => db.$disconnect());

async function user(email: string) {
  return db.user.create({ data: { email } });
}

async function song(vocadbId: number, name: string, favoritedTimes = 1) {
  return db.song.create({
    data: {
      vocadbId, name, defaultName: name, defaultNameLanguage: "English", artistString: "Artist",
      songType: "Original", sourceStatus: "Finished", sourceCreatedAt: new Date("2026-01-01"),
      durationSeconds: 180, favoritedTimes, ratingScore: 5, cultureCodes: [], sourceVersion: 1,
      lastSyncedAt: new Date("2026-07-01"), syncStatus: SyncStatus.SYNCED,
    },
  });
}

// Test-local projection of every observable discovery response field. Live and
// snapshot reads must agree on ranking, mode, algorithm version, freshness, and
// pagination before an operator can enable snapshot reads.
function discoveryDigest(result: Awaited<ReturnType<typeof getDiscovery>>) {
  return {
    items: result.items.map((item) => item.id),
    mode: result.mode,
    algorithmVersion: result.algorithmVersion,
    freshness: result.freshness,
    pagination: result.pagination,
  };
}

describe("discovery repository", () => {
  it("returns public popular songs for anonymous visitors", async () => {
    const popular = await song(100, "Popular", 50);
    const hidden = await song(101, "Hidden", 100);
    await db.song.update({ where: { id: hidden.id }, data: { syncStatus: SyncStatus.PENDING } });
    const result = await getDiscovery(null, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("POPULAR");
    expect(result.items.map((item) => item.id)).toEqual([popular.id]);
  });

  it("ranks shared tags, excludes seeds, and isolates viewer relations", async () => {
    const viewer = await user("discover@example.com");
    const other = await user("other-discover@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 1, name: "Rock", additionalNames: [] } });
    const seed = await song(200, "Seed");
    const candidate = await song(201, "Candidate");
    await song(202, "Unrelated", 100);
    const otherSeed = await song(203, "Other seed");
    const otherCandidate = await song(204, "Other candidate");
    const otherTag = await db.tag.create({ data: { vocadbId: 2, name: "Other", additionalNames: [] } });
    await db.songTag.createMany({ data: [{ songId: seed.id, tagId: tag.id, count: 1, position: 0 }, { songId: candidate.id, tagId: tag.id, count: 1, position: 0 }, { songId: otherSeed.id, tagId: tag.id, count: 1, position: 0 }, { songId: otherCandidate.id, tagId: otherTag.id, count: 1, position: 0 }] });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });
    await db.favorite.create({ data: { userId: other.id, songId: otherSeed.id } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    expect(result.algorithmVersion).toBe(DISCOVERY_ALGORITHM_VERSION);
    expect(result.items.map((item) => item.id)).toContain(candidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(seed.id);
    expect(result.items.map((item) => item.id)).not.toContain(otherCandidate.id);
  });

  it("collects owner-playlist songs as seeds", async () => {
    const viewer = await user("owner-playlist@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 10, name: "Rock", additionalNames: [] } });
    const seed = await song(210, "Playlist seed");
    const candidate = await song(211, "Candidate");
    await db.songTag.createMany({ data: [
      { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: candidate.id, tagId: tag.id, count: 1, position: 0 },
    ] });
    const playlist = await db.playlist.create({
      data: { userId: viewer.id, name: "Mine", visibility: PlaylistVisibility.PRIVATE },
    });
    await db.playlistSong.create({ data: { playlistId: playlist.id, songId: seed.id, position: 0 } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    expect(result.items.map((item) => item.id)).toContain(candidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(seed.id);
  });

  it("collects collaborator-playlist songs as seeds and ignores unrelated playlists", async () => {
    const viewer = await user("collab@example.com");
    const owner = await user("playlist-owner@example.com");
    const stranger = await user("stranger-playlist@example.com");
    const sharedTag = await db.tag.create({ data: { vocadbId: 20, name: "Rock", additionalNames: [] } });
    const otherTag = await db.tag.create({ data: { vocadbId: 21, name: "Pop", additionalNames: [] } });
    const collabSeed = await song(220, "Collab seed");
    const collabCandidate = await song(221, "Collab candidate");
    const unrelatedSeed = await song(222, "Unrelated seed");
    const unrelatedCandidate = await song(223, "Unrelated candidate");
    await db.songTag.createMany({ data: [
      { songId: collabSeed.id, tagId: sharedTag.id, count: 1, position: 0 },
      { songId: collabCandidate.id, tagId: sharedTag.id, count: 1, position: 0 },
      { songId: unrelatedSeed.id, tagId: otherTag.id, count: 1, position: 0 },
      { songId: unrelatedCandidate.id, tagId: otherTag.id, count: 1, position: 0 },
    ] });
    const collabPlaylist = await db.playlist.create({
      data: { userId: owner.id, name: "Shared", visibility: PlaylistVisibility.PUBLIC },
    });
    await db.playlistCollaborator.create({ data: { playlistId: collabPlaylist.id, userId: viewer.id } });
    await db.playlistSong.create({ data: { playlistId: collabPlaylist.id, songId: collabSeed.id, position: 0 } });
    const unrelatedPlaylist = await db.playlist.create({
      data: { userId: stranger.id, name: "Stranger", visibility: PlaylistVisibility.PUBLIC },
    });
    await db.playlistSong.create({ data: { playlistId: unrelatedPlaylist.id, songId: unrelatedSeed.id, position: 0 } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    expect(result.items.map((item) => item.id)).toContain(collabCandidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(collabSeed.id);
    expect(result.items.map((item) => item.id)).not.toContain(unrelatedCandidate.id);
  });

  it("caps seeds at 500 and ignores favorited songs beyond the cap", async () => {
    const viewer = await user("seed-cap@example.com");
    const seedTag = await db.tag.create({ data: { vocadbId: 30, name: "SeedTag", additionalNames: [] } });
    const capTag = await db.tag.create({ data: { vocadbId: 31, name: "CapTag", additionalNames: [] } });
    const otherTag = await db.tag.create({ data: { vocadbId: 32, name: "OtherTag", additionalNames: [] } });
    const seedIds = Array.from(
      { length: 505 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    await db.song.createMany({
      data: seedIds.map((id, i) => ({
        id, vocadbId: 3000 + i, name: `Cap${i}`, defaultName: `Cap${i}`, defaultNameLanguage: "English",
        artistString: "Artist", songType: "Original", sourceStatus: "Finished",
        sourceCreatedAt: new Date("2026-01-01"), durationSeconds: 180, favoritedTimes: 1,
        ratingScore: 5, cultureCodes: [], sourceVersion: 1, lastSyncedAt: new Date("2026-07-01"),
        syncStatus: SyncStatus.SYNCED,
      })),
    });
    await db.favorite.createMany({ data: seedIds.map((id) => ({ userId: viewer.id, songId: id })) });
    const songTagRows = seedIds.slice(0, 500).map((id) => ({ songId: id, tagId: seedTag.id, count: 1, position: 0 }));
    songTagRows.push({ songId: seedIds[500], tagId: capTag.id, count: 1, position: 0 });
    for (const id of seedIds.slice(501)) songTagRows.push({ songId: id, tagId: otherTag.id, count: 1, position: 0 });
    await db.songTag.createMany({ data: songTagRows });
    const candidate = await song(3600, "Cap candidate");
    const nonCandidate = await song(3601, "Not a candidate");
    await db.songTag.createMany({ data: [
      { songId: candidate.id, tagId: seedTag.id, count: 1, position: 0 },
      { songId: nonCandidate.id, tagId: capTag.id, count: 1, position: 0 },
    ] });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    expect(result.items.map((item) => item.id)).toContain(candidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(nonCandidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(seedIds[500]);
  }, 20_000);

  it("filters hidden songs from seeds and candidates", async () => {
    const viewer = await user("hidden@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 40, name: "Rock", additionalNames: [] } });
    const visibleSeed = await song(400, "Visible seed");
    const pendingSeed = await song(401, "Pending seed");
    await db.song.update({ where: { id: pendingSeed.id }, data: { syncStatus: SyncStatus.PENDING } });
    const deletedSeed = await song(402, "Deleted seed");
    await db.song.update({ where: { id: deletedSeed.id }, data: { sourceDeleted: true } });
    const pendingCandidate = await song(403, "Pending candidate");
    await db.song.update({ where: { id: pendingCandidate.id }, data: { syncStatus: SyncStatus.PENDING } });
    const hiddenCandidate = await song(404, "Deleted candidate");
    await db.song.update({ where: { id: hiddenCandidate.id }, data: { sourceDeleted: true } });
    const visibleCandidate = await song(405, "Visible candidate");
    await db.songTag.createMany({ data: [
      { songId: visibleSeed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: pendingSeed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: deletedSeed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: pendingCandidate.id, tagId: tag.id, count: 1, position: 0 },
      { songId: hiddenCandidate.id, tagId: tag.id, count: 1, position: 0 },
      { songId: visibleCandidate.id, tagId: tag.id, count: 1, position: 0 },
    ] });
    await db.favorite.createMany({ data: [
      { userId: viewer.id, songId: visibleSeed.id },
      { userId: viewer.id, songId: pendingSeed.id },
      { userId: viewer.id, songId: deletedSeed.id },
    ] });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(visibleCandidate.id);
    expect(ids).not.toContain(pendingCandidate.id);
    expect(ids).not.toContain(hiddenCandidate.id);
    expect(result.pagination.totalItems).toBe(1);
  });

  it("returns the true total on a page beyond the last", async () => {
    const viewer = await user("deep-page@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 50, name: "Rock", additionalNames: [] } });
    const seed = await song(500, "Seed");
    const candidates = [];
    for (let index = 0; index < 30; index += 1) candidates.push(await song(501 + index, `Candidate ${index}`));
    await db.songTag.createMany({ data: [
      { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
      ...candidates.map((candidateSong) => ({ songId: candidateSong.id, tagId: tag.id, count: 1, position: 0 })),
    ] });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const lastPage = await getDiscovery(viewer.id, { page: 2, pageSize: 24 });
    expect(lastPage.pagination.totalItems).toBe(30);
    expect(lastPage.items).toHaveLength(6);
    const beyond = await getDiscovery(viewer.id, { page: 3, pageSize: 24 });
    expect(beyond.pagination.totalItems).toBe(30);
    expect(beyond.items).toHaveLength(0);
  });

  it("deduplicates a song that is both favorited and in a playlist", async () => {
    const viewer = await user("dedup@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 60, name: "Rock", additionalNames: [] } });
    const seed = await song(600, "Seed");
    const candidate = await song(601, "Candidate");
    await db.songTag.createMany({ data: [
      { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: candidate.id, tagId: tag.id, count: 1, position: 0 },
    ] });
    const playlist = await db.playlist.create({ data: { userId: viewer.id, name: "Mine" } });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });
    await db.playlistSong.create({ data: { playlistId: playlist.id, songId: seed.id, position: 0 } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("PERSONALIZED");
    expect(result.items.map((item) => item.id)).toContain(candidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(seed.id);
    expect(result.pagination.totalItems).toBe(1);
  });

  it("falls back to popular when seeds yield no candidates", async () => {
    const viewer = await user("zero-candidate@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 70, name: "Rock", additionalNames: [] } });
    const seed = await song(700, "Seed", 1);
    const popular = await song(701, "Popular", 100);
    await db.songTag.create({ data: { songId: seed.id, tagId: tag.id, count: 1, position: 0 } });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });
    expect(result.mode).toBe("POPULAR");
    // The popular fallback lists all public songs; the seed is public too.
    expect(result.items.map((item) => item.id)).toEqual([popular.id, seed.id]);
  });

  it("uses a current ready snapshot authoritatively with rank pagination", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("snapshot-fresh@example.com");
    const first = await song(800, "First snapshot result");
    const second = await song(801, "Second snapshot result");
    const third = await song(802, "Third snapshot result");
    await song(803, "More popular fallback", 1_000);
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 3,
        catalogVersion: 5,
        status: "READY",
        totalItems: 3,
        finishedAt: new Date(),
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 3,
        requiredCatalogVersion: 5,
        currentSnapshotId: snapshot.id,
      },
    });
    await db.discoverySnapshotItem.createMany({
      data: [
        { snapshotId: snapshot.id, rank: 0, songId: first.id, score: 30 },
        { snapshotId: snapshot.id, rank: 1, songId: second.id, score: 20 },
        { snapshotId: snapshot.id, rank: 2, songId: third.id, score: 10 },
      ],
    });

    const firstPage = await getDiscovery(viewer.id, { page: 1, pageSize: 2 });
    const secondPage = await getDiscovery(viewer.id, { page: 2, pageSize: 2 });

    expect(firstPage.mode).toBe("PERSONALIZED");
    expect(firstPage.freshness).toBe("FRESH");
    expect(firstPage.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(secondPage.items.map((item) => item.id)).toEqual([third.id]);
    expect(secondPage.pagination).toMatchObject({ totalItems: 3, totalPages: 2 });
  });

  it("keeps a stale ready snapshot personalized", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("snapshot-stale@example.com");
    const staleResult = await song(810, "Stale snapshot result");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 2,
        catalogVersion: 4,
        status: "READY",
        totalItems: 1,
        finishedAt: new Date(),
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 3,
        requiredCatalogVersion: 5,
        currentSnapshotId: snapshot.id,
      },
    });
    await db.discoverySnapshotItem.create({
      data: { snapshotId: snapshot.id, rank: 0, songId: staleResult.id, score: 10 },
    });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.freshness).toBe("STALE");
    expect(result.items.map((item) => item.id)).toEqual([staleResult.id]);
  });

  it("defaults snapshot reads off and honors an explicit read option", async () => {
    delete process.env.DISCOVERY_SNAPSHOT_READS_ENABLED;
    const viewer = await user("read-option-gate@example.com");
    const snapshotOnly = await song(850, "Snapshot-only stale result");
    for (let i = 0; i < 24; i += 1) await song(860 + i, `Popular ${i}`, 100);
    const snapshotRow = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 2,
        catalogVersion: 4,
        status: "READY",
        totalItems: 1,
        finishedAt: new Date(),
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 3,
        requiredCatalogVersion: 5,
        currentSnapshotId: snapshotRow.id,
      },
    });
    await db.discoverySnapshotItem.create({
      data: { snapshotId: snapshotRow.id, rank: 0, songId: snapshotOnly.id, score: 10 },
    });

    const live = await getDiscovery(viewer.id, { page: 1, pageSize: 24 }, db, {
      snapshotReadsEnabled: false,
    });
    const snapshot = await getDiscovery(viewer.id, { page: 1, pageSize: 24 }, db, {
      snapshotReadsEnabled: true,
    });
    const defaults = await getDiscovery(viewer.id, { page: 1, pageSize: 24 }, db);

    expect(live).toMatchObject({ freshness: "FRESH", mode: "POPULAR" });
    expect(live.items.map((item) => item.id)).not.toContain(snapshotOnly.id);
    expect(snapshot).toMatchObject({ freshness: "STALE", mode: "PERSONALIZED" });
    expect(snapshot.items.map((item) => item.id)).toEqual([snapshotOnly.id]);
    expect(defaults).toEqual(live);
  });

  it("returns popular pending while favorite seeds have no usable snapshot", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("snapshot-pending@example.com");
    const seed = await song(820, "Favorite seed", 1);
    const popular = await song(821, "Popular fallback", 100);
    const snapshot = await db.discoverySnapshot.create({
      data: { userId: viewer.id, libraryVersion: 1, catalogVersion: 1, status: "BUILDING" },
    });
    await db.discoveryProfile.create({
      data: { userId: viewer.id, libraryVersion: 1, requiredCatalogVersion: 1, currentSnapshotId: snapshot.id },
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });

    expect(result.mode).toBe("POPULAR");
    expect(result.freshness).toBe("PENDING");
    expect(result.items.map((item) => item.id)).toEqual([popular.id, seed.id]);
  });

  it("filters hidden fresh snapshot items before pagination", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("snapshot-fresh-hidden-item@example.com");
    const removed = await song(835, "Deleted fresh snapshot result");
    const hidden = await song(836, "Hidden fresh snapshot result");
    const visible = await song(837, "Visible fresh snapshot result");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        totalItems: 3,
        finishedAt: new Date(),
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
    await db.discoverySnapshotItem.createMany({
      data: [
        { snapshotId: snapshot.id, rank: 0, songId: removed.id, score: 30 },
        { snapshotId: snapshot.id, rank: 1, songId: hidden.id, score: 20 },
        { snapshotId: snapshot.id, rank: 2, songId: visible.id, score: 10 },
      ],
    });
    await db.song.update({ where: { id: removed.id }, data: { sourceDeleted: true } });
    await db.song.update({ where: { id: hidden.id }, data: { syncStatus: SyncStatus.PENDING } });

    const firstPage = await getDiscovery(viewer.id, { page: 1, pageSize: 1 });
    const secondPage = await getDiscovery(viewer.id, { page: 2, pageSize: 1 });

    expect(firstPage.mode).toBe("PERSONALIZED");
    expect(firstPage.freshness).toBe("FRESH");
    expect(firstPage.items.map((item) => item.id)).toEqual([visible.id]);
    expect(firstPage.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(secondPage.items).toEqual([]);
    expect(secondPage.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
  });

  it("omits deleted stale snapshot items before pagination", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("snapshot-hidden-item@example.com");
    const first = await song(840, "Visible stale snapshot result");
    const removed = await song(841, "Deleted stale snapshot result");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        totalItems: 2,
        finishedAt: new Date(),
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 2,
        requiredCatalogVersion: 2,
        currentSnapshotId: snapshot.id,
      },
    });
    await db.discoverySnapshotItem.createMany({
      data: [
        { snapshotId: snapshot.id, rank: 0, songId: removed.id, score: 20 },
        { snapshotId: snapshot.id, rank: 1, songId: first.id, score: 10 },
      ],
    });
    await db.song.update({ where: { id: removed.id }, data: { sourceDeleted: true } });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 1 });

    expect(result.items.map((item) => item.id)).toEqual([first.id]);
    expect(result.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
  });

  it("marks a ready snapshot stale after catalog invalidation without rewriting profiles", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("catalog-stale@example.com");
    const result = await song(830, "Catalog stale snapshot result");
    const snapshot = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        totalItems: 1,
        finishedAt: new Date(),
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
    await db.discoverySnapshotItem.create({
      data: { snapshotId: snapshot.id, rank: 0, songId: result.id, score: 10 },
    });
    await db.discoveryCatalogState.create({
      data: { id: "catalog", version: 1 },
    });
    await db.$transaction(async (tx) => {
      await invalidateDiscoveryCatalog(tx);
    });

    const profile = await db.discoveryProfile.findUniqueOrThrow({
      where: { userId: viewer.id },
    });
    const discovery = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });

    expect(profile.requiredCatalogVersion).toBe(1);
    expect(discovery).toMatchObject({ mode: "PERSONALIZED", freshness: "STALE" });
  });

  it("serves a fresh personalized candidate from a materialized snapshot", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("materialized-fresh@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 90, name: "Rock", additionalNames: [] } });
    const seed = await song(900, "Materialized favorite seed");
    const candidate = await song(901, "Materialized shared-tag candidate");
    await db.songTag.createMany({ data: [
      { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: candidate.id, tagId: tag.id, count: 1, position: 0 },
    ] });
    await setFavorite(viewer.id, seed.id, true);

    expect(await materializeDiscoverySnapshots(1, db)).toEqual({
      selectedCount: 1,
      attemptedCount: 1,
      publishedCount: 1,
      failedCount: 0,
      deferredCount: 0,
      stopReason: "LIMIT_REACHED",
      batchBudgetMs: null,
      attemptReservationMs: null,
    });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.freshness).toBe("FRESH");
    expect(result.items.map((item) => item.id)).toEqual([candidate.id]);
  });

  it("keeps fresh snapshot reads in parity with live ranking across deep pages", async () => {
    const viewer = await user("parity-deep@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 92, name: "Parity", additionalNames: [] } });
    const seed = await song(930, "Parity seed");
    const candidates = [];
    for (let index = 0; index < 26; index += 1) candidates.push(await song(940 + index, `Parity candidate ${index}`));
    await db.songTag.createMany({
      data: [
        { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
        ...candidates.map((candidateSong) => ({ songId: candidateSong.id, tagId: tag.id, count: 1, position: 0 })),
      ],
    });
    await setFavorite(viewer.id, seed.id, true);
    expect(await materializeDiscoverySnapshots(1, db)).toMatchObject({
      attemptedCount: 1,
      publishedCount: 1,
    });

    for (const query of [
      { page: 1, pageSize: 24 },
      { page: 2, pageSize: 24 },
    ]) {
      const live = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: false });
      const snapshot = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true });
      expect(discoveryDigest(snapshot)).toEqual(discoveryDigest(live));
      expect(snapshot.freshness).toBe("FRESH");
    }
  });

  it("walks snapshot freshness through invalidation, rebuild, and catalog invalidation", async () => {
    const viewer = await user("parity-lifecycle@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 93, name: "Lifecycle", additionalNames: [] } });
    const seed = await song(950, "Lifecycle seed");
    const addedSeed = await song(951, "Added lifecycle seed");
    const candidate = await song(952, "Lifecycle candidate");
    await db.songTag.createMany({
      data: [
        { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
        { songId: addedSeed.id, tagId: tag.id, count: 1, position: 0 },
        { songId: candidate.id, tagId: tag.id, count: 1, position: 0 },
      ],
    });
    await setFavorite(viewer.id, seed.id, true);
    await materializeDiscoverySnapshots(1, db);
    const query = { page: 1, pageSize: 24 };

    expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("FRESH");
    await setFavorite(viewer.id, addedSeed.id, true);
    expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("STALE");
    await materializeDiscoverySnapshots(1, db);
    expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("FRESH");
    await db.$transaction((tx) => invalidateDiscoveryCatalog(tx));
    expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("STALE");

    // A separate viewer with a favorite seed but no usable current snapshot
    // stays PENDING and falls back to the public popular list.
    const pendingViewer = await user("parity-lifecycle-pending@example.com");
    const pendingSeed = await song(953, "Pending lifecycle seed");
    const popular = await song(954, "Pending popular fallback", 100);
    await setFavorite(pendingViewer.id, pendingSeed.id, true);
    const pending = await getDiscovery(pendingViewer.id, query, db, { snapshotReadsEnabled: true });
    const pendingLive = await getDiscovery(pendingViewer.id, query, db, { snapshotReadsEnabled: false });
    expect(pending.freshness).toBe("PENDING");
    expect(pending.mode).toBe("POPULAR");
    expect(pending.items.map((item) => item.id)).toEqual(pendingLive.items.map((item) => item.id));
    expect(pending.items.map((item) => item.id)).toContain(popular.id);
  });

  it("admits a profile when exactly one batch reservation remains", async () => {
    const viewer = await user("budget-exact@example.com");
    await db.discoveryProfile.create({ data: { userId: viewer.id } });
    const timing = {
      buildTimeoutMs: 30_000,
      statementTimeoutMs: 20_000,
      buildLeaseMs: 90_000,
      batchBudgetMs: 150_000,
      attemptReservationMs: 150_000,
    };

    expect(await materializeDiscoverySnapshots(1, db, {
      batchTiming: timing,
      now: () => 0,
    })).toMatchObject({
      selectedCount: 1,
      attemptedCount: 1,
      publishedCount: 1,
      failedCount: 0,
      deferredCount: 0,
      stopReason: "LIMIT_REACHED",
    });
  });

  it("defers unclaimed stale profiles when batch budget has no reservation remaining", async () => {
    const first = await user("budget-first@example.com");
    const second = await user("budget-second@example.com");
    await db.discoveryProfile.createMany({
      data: [{ userId: first.id }, { userId: second.id }],
    });
    let clockCalls = 0;
    const timing = {
      buildTimeoutMs: 30_000,
      statementTimeoutMs: 20_000,
      buildLeaseMs: 90_000,
      batchBudgetMs: 150_000,
      attemptReservationMs: 150_000,
    };

    const bounded = await materializeDiscoverySnapshots(2, db, {
      batchTiming: timing,
      now: () => (clockCalls++ === 0 ? 0 : 1),
    });

    expect(bounded).toMatchObject({
      selectedCount: 2,
      attemptedCount: 0,
      publishedCount: 0,
      failedCount: 0,
      deferredCount: 2,
      stopReason: "BUDGET_EXHAUSTED",
      batchBudgetMs: 150_000,
      attemptReservationMs: 150_000,
    });
    expect(await db.discoveryProfile.findMany({
      where: { userId: { in: [first.id, second.id] } },
      select: { refreshStartedAt: true, lastRefreshError: true },
    })).toEqual([
      { refreshStartedAt: null, lastRefreshError: null },
      { refreshStartedAt: null, lastRefreshError: null },
    ]);
    expect(await db.discoverySnapshot.count()).toBe(0);

    expect(await materializeDiscoverySnapshots(2, db)).toMatchObject({
      selectedCount: 2,
      attemptedCount: 2,
      publishedCount: 2,
      failedCount: 0,
      deferredCount: 0,
      stopReason: "LIMIT_REACHED",
    });
  });

  it("terminates an expired build before publishing its replacement", async () => {
    const viewer = await user("expired-build@example.com");
    const seed = await song(915, "Expired build seed");
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });
    const expiredAt = new Date(Date.now() - 8 * 60_000);
    const abandoned = await db.discoverySnapshot.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        catalogVersion: 0,
        status: "BUILDING",
        startedAt: expiredAt,
      },
    });
    await db.discoveryProfile.create({
      data: {
        userId: viewer.id,
        libraryVersion: 1,
        refreshStartedAt: expiredAt,
      },
    });

    expect(await materializeDiscoverySnapshots(1, db)).toMatchObject({
      attemptedCount: 1,
      publishedCount: 1,
      failedCount: 0,
    });
    expect(await db.discoverySnapshot.findUniqueOrThrow({ where: { id: abandoned.id } })).toMatchObject({
      status: "FAILED",
      errorCode: "BUILD_LEASE_EXPIRED",
      finishedAt: expect.any(Date),
    });
  });

  it("prunes only expired non-current terminal snapshots in deterministic batches", async () => {
    const cutoff = new Date("2026-08-01T00:00:00.000Z");
    const oldestUser = await user("cleanup-oldest@example.com");
    const failedUser = await user("cleanup-failed@example.com");
    const activeUser = await user("cleanup-active@example.com");
    const buildingUser = await user("cleanup-building@example.com");
    const unfinishedUser = await user("cleanup-unfinished@example.com");
    const recentUser = await user("cleanup-recent@example.com");
    const item = await song(920, "Expired snapshot item");
    const oldReady = await db.discoverySnapshot.create({
      data: {
        userId: oldestUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        finishedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    await db.discoverySnapshotItem.create({
      data: { snapshotId: oldReady.id, rank: 0, songId: item.id, score: 1 },
    });
    const oldFailed = await db.discoverySnapshot.create({
      data: {
        userId: failedUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "FAILED",
        finishedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    });
    const active = await db.discoverySnapshot.create({
      data: {
        userId: activeUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        finishedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    await db.discoveryProfile.create({
      data: { userId: activeUser.id, currentSnapshotId: active.id },
    });
    const building = await db.discoverySnapshot.create({
      data: {
        userId: buildingUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "BUILDING",
        startedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    const unfinished = await db.discoverySnapshot.create({
      data: {
        userId: unfinishedUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "FAILED",
      },
    });
    const recent = await db.discoverySnapshot.create({
      data: {
        userId: recentUser.id,
        libraryVersion: 1,
        catalogVersion: 1,
        status: "READY",
        finishedAt: cutoff,
      },
    });

    expect(await deleteExpiredDiscoverySnapshots(db, cutoff, 1)).toBe(1);
    expect(await db.discoverySnapshot.findUnique({ where: { id: oldReady.id } })).toBeNull();
    expect(await db.discoverySnapshotItem.count({ where: { snapshotId: oldReady.id } })).toBe(0);
    expect(await db.discoverySnapshot.findUnique({ where: { id: oldFailed.id } })).not.toBeNull();

    expect(await deleteExpiredDiscoverySnapshots(db, cutoff, 10)).toBe(1);
    expect(await db.discoverySnapshot.findUnique({ where: { id: oldFailed.id } })).toBeNull();
    expect(await db.discoverySnapshot.findMany({
      where: { id: { in: [active.id, building.id, unfinished.id, recent.id] } },
      select: { id: true },
    })).toHaveLength(4);
    expect(await db.discoveryProfile.findUniqueOrThrow({ where: { userId: activeUser.id } })).toMatchObject({
      currentSnapshotId: active.id,
    });
  });

  it("serves fresh popular results after rematerializing an empty favorite profile", async () => {
    process.env.DISCOVERY_SNAPSHOT_READS_ENABLED = "true";
    const viewer = await user("materialized-empty@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 91, name: "Rock", additionalNames: [] } });
    const seed = await song(910, "Rematerialized favorite seed", 1);
    const candidate = await song(911, "Old personalized candidate");
    const popular = await song(912, "Fresh popular fallback", 100);
    await db.songTag.createMany({ data: [
      { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
      { songId: candidate.id, tagId: tag.id, count: 1, position: 0 },
    ] });
    await setFavorite(viewer.id, seed.id, true);
    await materializeDiscoverySnapshots(1, db);

    expect(await setFavorite(viewer.id, seed.id, false)).toBe("UPDATED");
    expect(await materializeDiscoverySnapshots(1, db)).toEqual({
      selectedCount: 1,
      attemptedCount: 1,
      publishedCount: 1,
      failedCount: 0,
      deferredCount: 0,
      stopReason: "LIMIT_REACHED",
      batchBudgetMs: null,
      attemptReservationMs: null,
    });
    const profile = await db.discoveryProfile.findUniqueOrThrow({
      where: { userId: viewer.id },
      include: { currentSnapshot: true },
    });
    expect(profile.currentSnapshot).toMatchObject({ status: "READY", totalItems: 0 });

    const result = await getDiscovery(viewer.id, { page: 1, pageSize: 24 });

    expect(result.mode).toBe("POPULAR");
    expect(result.freshness).toBe("FRESH");
    expect(result.items.map((item) => item.id)).toEqual(expect.arrayContaining([popular.id, candidate.id, seed.id]));
  });

  it("keeps fresh snapshot and live parity on a materialized zero-candidate profile", async () => {
    const viewer = await user("parity-zero-candidate@example.com");
    const tag = await db.tag.create({ data: { vocadbId: 94, name: "Zero", additionalNames: [] } });
    const seed = await song(960, "Zero-candidate seed");
    await song(961, "Zero-candidate popular", 100);
    await db.songTag.create({ data: { songId: seed.id, tagId: tag.id, count: 1, position: 0 } });
    await setFavorite(viewer.id, seed.id, true);
    expect(await materializeDiscoverySnapshots(1, db)).toMatchObject({
      attemptedCount: 1,
      publishedCount: 1,
    });
    const profile = await db.discoveryProfile.findUniqueOrThrow({
      where: { userId: viewer.id },
      include: { currentSnapshot: true },
    });
    expect(profile.currentSnapshot).toMatchObject({ status: "READY", totalItems: 0 });

    const query = { page: 1, pageSize: 24 };
    const live = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: false });
    const snapshot = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true });

    // Seed exists but has no matching candidates: materialized zero-item
    // snapshot and live path both use POPULAR.
    expect(discoveryDigest(snapshot)).toEqual(discoveryDigest(live));
    expect(snapshot.freshness).toBe("FRESH");
    expect(snapshot.mode).toBe("POPULAR");
  });

  it("keeps anonymous popular results in parity when snapshot reads are enabled", async () => {
    const popular = await song(970, "Anonymous popular", 100);
    const second = await song(971, "Anonymous second");
    const query = { page: 1, pageSize: 24 };
    const live = await getDiscovery(null, query, db, { snapshotReadsEnabled: false });
    const snapshot = await getDiscovery(null, query, db, { snapshotReadsEnabled: true });

    // Anonymous visitor never has a profile: read selection leaves the public
    // POPULAR result unchanged.
    expect(discoveryDigest(snapshot)).toEqual(discoveryDigest(live));
    expect(snapshot.freshness).toBe("FRESH");
    expect(snapshot.mode).toBe("POPULAR");
    expect(snapshot.items.map((item) => item.id)).toEqual([popular.id, second.id]);
  });
});
