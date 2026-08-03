import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { getDiscovery } from "@/lib/discover/repository";

const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => db.$connect());
beforeEach(async () => {
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
    expect(result.items.map((item) => item.id)).toContain(candidate.id);
    expect(result.items.map((item) => item.id)).not.toContain(seed.id);
    expect(result.items.map((item) => item.id)).not.toContain(otherCandidate.id);
  });
});
