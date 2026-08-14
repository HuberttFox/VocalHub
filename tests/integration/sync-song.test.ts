import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import {
  markSongSourceDeleted,
  markSongSyncFailure,
  syncVocaDbSong,
} from "@/lib/vocadb/sync-song";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.discoveryCatalogState.deleteMany();
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

async function catalogVersion() {
  return (
    (await db.discoveryCatalogState.findUnique({ where: { id: "catalog" } }))
      ?.version ?? 0
  );
}

describe("syncVocaDbSong", () => {
  it("keeps local UUID and relation counts stable across repeated syncs", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    const first = await syncVocaDbSong(
      db,
      input,
      new Date("2026-01-01T00:00:00Z"),
    );
    const second = await syncVocaDbSong(
      db,
      input,
      new Date("2026-01-02T00:00:00Z"),
    );

    expect(second.id).toBe(first.id);
    expect(await db.song.count()).toBe(1);
    expect(await db.artist.count()).toBe(
      input.artistCredits.filter((credit) => credit.artist).length,
    );
    expect(await db.songArtistCredit.count()).toBe(input.artistCredits.length);
    expect(await db.tag.count()).toBe(input.tags.length);
    expect(await db.songTag.count()).toBe(input.tags.length);
    expect(await db.songPV.count()).toBe(input.pvs.length);

    const song = await db.song.findUniqueOrThrow({ where: { id: first.id } });
    expect(song.lastSyncedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("bumps the catalog once for initial creation but not an identical repeat", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );

    await syncVocaDbSong(db, input);
    expect(await catalogVersion()).toBe(1);

    await syncVocaDbSong(db, input);
    expect(await catalogVersion()).toBe(1);
  });

  it("does not bump for metadata-only relation changes", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    await syncVocaDbSong(db, input);

    await syncVocaDbSong(db, {
      ...input,
      names: input.names.map((name) => ({
        ...name,
        value: `${name.value} updated`,
      })),
      artistCredits: input.artistCredits.map((credit, index) =>
        index === 0
          ? {
              ...credit,
              name: "Updated credit",
              categories: ["Updated category"],
              roles: ["Updated role"],
              effectiveRoles: ["Updated effective role"],
              isSupport: !credit.isSupport,
              isCustomName: !credit.isCustomName,
              position: credit.position + 1,
            }
          : credit,
      ),
      tags: input.tags.map((tag) => ({
        ...tag,
        count: tag.count + 1,
        position: tag.position + 1,
      })),
      pvs: input.pvs.map((pv) => ({ ...pv, name: "Updated PV" })),
    });

    expect(await catalogVersion()).toBe(1);
  });

  it("bumps for favorites and rating changes", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    await syncVocaDbSong(db, input);
    expect(await catalogVersion()).toBe(1);

    await syncVocaDbSong(db, {
      ...input,
      favoritedTimes: input.favoritedTimes + 1,
    });
    expect(await catalogVersion()).toBe(2);

    await syncVocaDbSong(db, { ...input, ratingScore: input.ratingScore + 1 });
    expect(await catalogVersion()).toBe(3);
  });

  it("does not bump for favorites or ratings above discovery score caps", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    const capped = {
      ...input,
      favoritedTimes: 1_000,
      ratingScore: 100,
    };

    await syncVocaDbSong(db, capped);
    expect(await catalogVersion()).toBe(1);

    await syncVocaDbSong(db, {
      ...capped,
      favoritedTimes: capped.favoritedTimes + 1,
      ratingScore: capped.ratingScore + 1,
    });
    expect(await catalogVersion()).toBe(1);
  });

  it("bumps for tag and artist ID set changes but not tag or credit metadata", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    await syncVocaDbSong(db, input);

    await syncVocaDbSong(db, {
      ...input,
      tags: input.tags.map((tag) => ({
        ...tag,
        count: tag.count + 1,
        position: tag.position + 1,
      })),
      artistCredits: input.artistCredits.map((credit) => ({
        ...credit,
        name: `${credit.name} updated`,
      })),
    });
    expect(await catalogVersion()).toBe(1);

    await syncVocaDbSong(db, {
      ...input,
      tags: [
        ...input.tags,
        {
          vocadbId: 301,
          name: "New tag",
          additionalNames: [],
          categoryName: null,
          urlSlug: "new-tag",
          count: 1,
          position: 1,
        },
      ],
    });
    expect(await catalogVersion()).toBe(2);

    const artist = input.artistCredits[0].artist!;
    await syncVocaDbSong(db, {
      ...input,
      tags: [
        ...input.tags,
        {
          vocadbId: 301,
          name: "New tag",
          additionalNames: [],
          categoryName: null,
          urlSlug: "new-tag",
          count: 1,
          position: 1,
        },
      ],
      artistCredits: input.artistCredits.map((credit, index) =>
        index === 1
          ? {
              ...credit,
              artist: { ...artist, vocadbId: 101, name: "Second artist" },
            }
          : credit,
      ),
    });
    expect(await catalogVersion()).toBe(3);
  });

  it("does not bump for SYNCED or FAILED when visibility stays public", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    await syncVocaDbSong(db, input);
    expect(await catalogVersion()).toBe(1);

    expect(
      await markSongSyncFailure(
        db,
        input.vocadbId,
        SyncStatus.FAILED,
        "temporary failure",
      ),
    ).toBe(true);
    expect(await catalogVersion()).toBe(1);

    await syncVocaDbSong(db, input);
    expect(await catalogVersion()).toBe(1);
  });

  it("bumps direct failure and deletion only when public visibility changes", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    await syncVocaDbSong(db, input);

    expect(
      await markSongSyncFailure(
        db,
        input.vocadbId,
        SyncStatus.SOURCE_MISSING,
        "missing",
      ),
    ).toBe(true);
    expect(await catalogVersion()).toBe(2);
    expect(
      await markSongSyncFailure(
        db,
        input.vocadbId,
        SyncStatus.SOURCE_MISSING,
        "still missing",
      ),
    ).toBe(true);
    expect(await catalogVersion()).toBe(2);

    const secondInput = { ...input, vocadbId: input.vocadbId + 1 };
    await syncVocaDbSong(db, secondInput);
    expect(await catalogVersion()).toBe(3);

    expect(
      await markSongSourceDeleted(db, secondInput.vocadbId, "deleted"),
    ).toBe(true);
    expect(await catalogVersion()).toBe(4);
    expect(
      await markSongSourceDeleted(db, secondInput.vocadbId, "still deleted"),
    ).toBe(true);
    expect(await catalogVersion()).toBe(4);
  });

  it("updates fields and removes stale song relations", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    const first = await syncVocaDbSong(db, input);
    const changed = {
      ...input,
      name: "Updated title",
      sourceVersion: input.sourceVersion + 1,
      tags: input.tags.slice(0, 1),
      pvs: [],
      artistCredits: input.artistCredits.slice(0, 1),
    };

    await syncVocaDbSong(db, changed);

    expect(
      await db.song.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      name: "Updated title",
      sourceVersion: changed.sourceVersion,
    });
    expect(await db.songTag.count({ where: { songId: first.id } })).toBe(1);
    expect(await db.songPV.count({ where: { songId: first.id } })).toBe(0);
    expect(
      await db.songArtistCredit.count({ where: { songId: first.id } }),
    ).toBe(1);
  });

  it("clears all relations when complete source collections are empty", async () => {
    const input = normalizeVocaDbSong(
      vocaDbSongSchema.parse(vocaDbSongFixture),
    );
    const first = await syncVocaDbSong(db, input);

    await syncVocaDbSong(db, {
      ...input,
      artistCredits: [],
      tags: [],
      pvs: [],
    });

    expect(
      await db.songArtistCredit.count({ where: { songId: first.id } }),
    ).toBe(0);
    expect(await db.songTag.count({ where: { songId: first.id } })).toBe(0);
    expect(await db.songPV.count({ where: { songId: first.id } })).toBe(0);
  });
});
