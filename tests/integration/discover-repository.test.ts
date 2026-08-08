import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PlaylistVisibility, SyncStatus } from "@/generated/prisma/enums";
import { DISCOVERY_ALGORITHM_VERSION } from "@/lib/discover/dto";
import { getDiscovery } from "@/lib/discover/repository";

const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => db.$connect());
beforeEach(async () => {
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
});
