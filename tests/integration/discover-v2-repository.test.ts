import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { DISCOVERY_ALGORITHM_VERSION } from "@/lib/discover/dto";
import { getDiscoveryV2 } from "@/lib/discover/discovery-v2";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
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
      vocadbId,
      name,
      defaultName: name,
      defaultNameLanguage: "English",
      artistString: "Artist",
      songType: "Original",
      sourceStatus: "Finished",
      sourceCreatedAt: new Date("2026-01-01"),
      durationSeconds: 180,
      favoritedTimes,
      ratingScore: 5,
      cultureCodes: [],
      sourceVersion: 1,
      lastSyncedAt: new Date("2026-07-01"),
      syncStatus: SyncStatus.SYNCED,
    },
  });
}

describe("discovery repository V2", () => {
  it("bounds the candidate pool to the 24 highest-support seed features", async () => {
    const viewer = await user("v2-feature-pool@example.com");
    const tags = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        db.tag.create({
          data: {
            vocadbId: 1_000 + index,
            name: `Feature ${index}`,
            additionalNames: [],
          },
        }),
      ),
    );
    const supportedSeeds = await Promise.all(
      Array.from({ length: 48 }, (_, index) => song(1_000 + index, `Seed ${index}`)),
    );
    const lowerSupportSeed = await song(1_048, "Lower support seed");
    const candidates = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        song(1_100 + index, `Candidate ${index}`),
      ),
    );

    await db.songTag.createMany({
      data: [
        ...tags.slice(0, 24).flatMap((tag, index) => [
          {
            songId: supportedSeeds[index * 2].id,
            tagId: tag.id,
            count: 1,
            position: 0,
          },
          {
            songId: supportedSeeds[index * 2 + 1].id,
            tagId: tag.id,
            count: 1,
            position: 0,
          },
          { songId: candidates[index].id, tagId: tag.id, count: 1, position: 0 },
        ]),
        {
          songId: lowerSupportSeed.id,
          tagId: tags[24].id,
          count: 1,
          position: 0,
        },
        { songId: candidates[24].id, tagId: tags[24].id, count: 1, position: 0 },
      ],
    });
    await db.favorite.createMany({
      data: [...supportedSeeds, lowerSupportSeed].map((seed) => ({
        userId: viewer.id,
        songId: seed.id,
      })),
    });

    const result = await getDiscoveryV2(viewer.id, { page: 1, pageSize: 24 }, db);

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.pagination.totalItems).toBe(24);
    expect(result.items).toHaveLength(24);
    expect(result.items.map((item) => item.id)).toEqual(
      candidates
        .slice(0, 24)
        .map((candidate) => candidate.id)
        .sort(),
    );
    expect(result.items.map((item) => item.id)).not.toContain(candidates[24].id);
  });

  it("expands artist-only candidates and de-duplicates candidates shared by both features", async () => {
    const viewer = await user("v2-artist-candidates@example.com");
    const artist = await db.artist.create({
      data: {
        vocadbId: 1_500,
        name: "Artist",
        defaultName: "Artist",
        defaultNameLanguage: "English",
        additionalNames: [],
        artistType: "Producer",
        sourceStatus: "Finished",
        sourceVersion: 1,
        summaryName: "Artist",
        summaryArtistType: "Producer",
        summaryAdditionalNames: [],
        summarySourceStatus: "Finished",
        summarySourceVersion: 1,
      },
    });
    const tag = await db.tag.create({
      data: { vocadbId: 1_500, name: "Shared", additionalNames: [] },
    });
    const seed = await song(1_500, "Seed");
    const artistOnlyCandidate = await song(1_501, "Artist-only candidate");
    const sharedCandidate = await song(1_502, "Shared candidate");

    await db.songArtistCredit.createMany({
      data: [seed, artistOnlyCandidate, sharedCandidate].map((candidate, position) => ({
        vocadbId: 1_500 + position,
        songId: candidate.id,
        artistId: artist.id,
        name: artist.name,
        categories: [],
        roles: [],
        effectiveRoles: [],
        isSupport: false,
        isCustomName: false,
        position: 0,
      })),
    });
    await db.songTag.createMany({
      data: [seed, sharedCandidate].map((candidate) => ({
        songId: candidate.id,
        tagId: tag.id,
        count: 1,
        position: 0,
      })),
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscoveryV2(viewer.id, { page: 1, pageSize: 24 }, db);

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.pagination.totalItems).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).toEqual([
      sharedCandidate.id,
      artistOnlyCandidate.id,
    ]);
  });

  it("limits each selected feature to 160 candidates before ranking", async () => {
    const viewer = await user("v2-candidate-cap@example.com");
    const tag = await db.tag.create({
      data: { vocadbId: 2_000, name: "Cap", additionalNames: [] },
    });
    const seed = await song(2_000, "Seed");
    const candidates = await Promise.all(
      Array.from({ length: 161 }, (_, index) =>
        song(2_001 + index, `Candidate ${index}`, 1_000 - index),
      ),
    );
    await db.songTag.createMany({
      data: [
        { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
        ...candidates.map((candidate) => ({
          songId: candidate.id,
          tagId: tag.id,
          count: 1,
          position: 0,
        })),
      ],
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscoveryV2(viewer.id, { page: 7, pageSize: 24 }, db);

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.pagination.totalItems).toBe(160);
    expect(result.items).toHaveLength(16);
    expect(result.items.map((item) => item.id)).not.toContain(candidates[160].id);
  });

  it("limits artist candidates to 160 distinct songs before ranking", async () => {
    const viewer = await user("v2-artist-candidate-cap@example.com");
    const artist = await db.artist.create({
      data: {
        vocadbId: 2_500,
        name: "Cap artist",
        defaultName: "Cap artist",
        defaultNameLanguage: "English",
        additionalNames: [],
        artistType: "Producer",
        sourceStatus: "Finished",
        sourceVersion: 1,
        summaryName: "Cap artist",
        summaryArtistType: "Producer",
        summaryAdditionalNames: [],
        summarySourceStatus: "Finished",
        summarySourceVersion: 1,
      },
    });
    const seed = await song(2_500, "Artist seed");
    const candidates = await Promise.all(
      Array.from({ length: 162 }, (_, index) =>
        song(2_501 + index, `Artist candidate ${index}`, 1_000 - index),
      ),
    );

    await db.songArtistCredit.createMany({
      data: [
        {
          vocadbId: 2_500,
          songId: seed.id,
          artistId: artist.id,
          name: artist.name,
          categories: [],
          roles: [],
          effectiveRoles: [],
          isSupport: false,
          isCustomName: false,
          position: 0,
        },
        ...candidates.flatMap((candidate, index) =>
          Array.from({ length: index < 5 ? 2 : 1 }, (_, duplicate) => ({
            vocadbId: 2_501 + index * 2 + duplicate,
            songId: candidate.id,
            artistId: artist.id,
            name: artist.name,
            categories: [],
            roles: [],
            effectiveRoles: [],
            isSupport: false,
            isCustomName: false,
            position: duplicate,
          })),
        ),
      ],
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscoveryV2(viewer.id, { page: 7, pageSize: 24 }, db);

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.pagination.totalItems).toBe(160);
    expect(result.items).toHaveLength(16);
    expect(result.items.map((item) => item.id)).toContain(candidates[159].id);
    expect(result.items.map((item) => item.id)).not.toContain(candidates[160].id);
  });

  it("preserves V1 visibility, seed exclusion, metadata, and fallback contracts", async () => {
    const viewer = await user("v2-shared-contracts@example.com");
    const tag = await db.tag.create({
      data: { vocadbId: 3_000, name: "Shared", additionalNames: [] },
    });
    const seed = await song(3_000, "Seed", 1);
    const visibleCandidate = await song(3_001, "Visible candidate", 10);
    const hiddenCandidate = await song(3_002, "Hidden candidate", 100);
    await db.song.update({
      where: { id: hiddenCandidate.id },
      data: { syncStatus: SyncStatus.PENDING },
    });
    await db.songTag.createMany({
      data: [
        { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
        { songId: visibleCandidate.id, tagId: tag.id, count: 1, position: 0 },
        { songId: hiddenCandidate.id, tagId: tag.id, count: 1, position: 0 },
      ],
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const personalized = await getDiscoveryV2(
      viewer.id,
      { page: 1, pageSize: 24 },
      db,
    );
    expect(personalized.mode).toBe("PERSONALIZED");
    expect(personalized.algorithmVersion).toBe(DISCOVERY_ALGORITHM_VERSION);
    expect(personalized.items.map((item) => item.id)).toEqual([visibleCandidate.id]);

    await db.songTag.deleteMany();
    const fallback = await getDiscoveryV2(viewer.id, { page: 1, pageSize: 24 }, db);
    expect(fallback.mode).toBe("POPULAR");
    expect(fallback.items.map((item) => item.id)).toEqual([
      visibleCandidate.id,
      seed.id,
    ]);
  });

  it("reports the exact bounded total beyond the last page", async () => {
    const viewer = await user("v2-deep-page@example.com");
    const tag = await db.tag.create({
      data: { vocadbId: 4_000, name: "Deep page", additionalNames: [] },
    });
    const seed = await song(4_000, "Seed");
    const candidates = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        song(4_001 + index, `Candidate ${index}`),
      ),
    );
    await db.songTag.createMany({
      data: [
        { songId: seed.id, tagId: tag.id, count: 1, position: 0 },
        ...candidates.map((candidate) => ({
          songId: candidate.id,
          tagId: tag.id,
          count: 1,
          position: 0,
        })),
      ],
    });
    await db.favorite.create({ data: { userId: viewer.id, songId: seed.id } });

    const result = await getDiscoveryV2(viewer.id, { page: 3, pageSize: 24 }, db);

    expect(result.mode).toBe("PERSONALIZED");
    expect(result.pagination.totalItems).toBe(30);
    expect(result.pagination.totalPages).toBe(2);
    expect(result.items).toHaveLength(0);
  });
});
