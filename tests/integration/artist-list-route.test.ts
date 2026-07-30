import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { GET as getArtists } from "@/app/api/artists/route";
import { listArtists } from "@/lib/artists/list-repository";
import { PUBLIC_ARTIST_WHERE } from "@/lib/catalog/visibility";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { makeVocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.artistWebLink.deleteMany();
  await db.artistName.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

async function seedArtistSong(
  artistId: number,
  artistName: string,
  songId = artistId + 10_000,
  additionalNames = "",
) {
  const base = makeVocaDbSongFixture();
  const credit = base.artists[0];
  const fixture = {
    ...base,
    id: songId,
    name: `Song ${songId}`,
    defaultName: `Song ${songId}`,
    artists: [
      {
        ...credit,
        id: artistId * 10,
        name: artistName,
        artist: {
          ...credit.artist!,
          id: artistId,
          name: artistName,
          additionalNames,
        },
      },
    ],
  };
  await syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(fixture)),
  );
  return db.artist.findUniqueOrThrow({ where: { vocadbId: artistId } });
}

function artistsRequest(query = "") {
  return getArtists(new Request(
    `http://localhost/api/artists${query ? `?${query}` : ""}`,
  ));
}

describe("artist catalog API", () => {
  it("returns the default envelope without internal artist fields", async () => {
    const artist = await seedArtistSong(190, "Producer");
    const response = await artistsRequest();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      items: [expect.objectContaining({ id: artist.id, name: "Producer" })],
      query: { q: null },
      pagination: { page: 1, pageSize: 24, totalItems: 1, totalPages: 1 },
    });
    expect(payload.items[0]).not.toHaveProperty("vocadbId");
    expect(payload.items[0]).not.toHaveProperty("syncStatus");
    expect(payload.items[0]).not.toHaveProperty("lastSyncError");
    expect(payload.items[0]).not.toHaveProperty("pictureUrlOriginal");
  });

  it("normalizes valid queries and rejects invalid list parameters", async () => {
    await seedArtistSong(191, "Producer");

    const searched = await artistsRequest("q=%20Producer%20");
    expect(searched.status).toBe(200);
    expect((await searched.json()).query).toEqual({ q: "Producer" });

    for (const query of ["q=one&q=two", `q=${"a".repeat(101)}`, "page=0", "pageSize=51"]) {
      const response = await artistsRequest(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_QUERY");
    }
  });

  it("ignores unknown query keys", async () => {
    await seedArtistSong(192, "Producer");
    const response = await artistsRequest("unused=value");

    expect(response.status).toBe(200);
    expect((await response.json()).query).toEqual({ q: null });
  });
});

describe("artist catalog repository", () => {
  it("uses the public artist collection and distinct public song counts", async () => {
    const synced = await seedArtistSong(200, "Synced");
    const failed = await seedArtistSong(201, "Failed");
    const pending = await seedArtistSong(202, "Pending");
    const deleted = await seedArtistSong(203, "Deleted");
    const merged = await seedArtistSong(204, "Merged");
    const hidden = await seedArtistSong(205, "Hidden");

    await db.artist.update({ where: { id: failed.id }, data: { syncStatus: SyncStatus.FAILED } });
    await db.song.updateMany({ where: { vocadbId: 10_202 }, data: { syncStatus: SyncStatus.PENDING } });
    await db.artist.update({ where: { id: deleted.id }, data: { sourceDeleted: true } });
    await db.artist.update({ where: { id: merged.id }, data: { mergedToVocaDbId: 999 } });
    await db.song.updateMany({ where: { vocadbId: 10_205 }, data: { sourceDeleted: true } });

    const result = await listArtists({ page: 1, pageSize: 24 }, db);
    const expected = await db.artist.findMany({
      where: PUBLIC_ARTIST_WHERE,
      select: { id: true },
      orderBy: { id: "asc" },
    });

    expect(result.items.map(({ id }) => id).sort()).toEqual(expected.map(({ id }) => id));
    expect(result.items.map(({ id }) => id)).toEqual([failed.id, synced.id]);
    expect(result.pagination.totalItems).toBe(2);
    expect(result.items.every(({ publicSongCount }) => publicSongCount === 1)).toBe(true);
    expect(result.items.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([pending.id, deleted.id, merged.id, hidden.id]),
    );
  });

  it("deduplicates credits and name matches while applying literal search semantics", async () => {
    const matching = await seedArtistSong(210, "100%_\\ Artist", 10_210, "ExactAlias");
    const base = makeVocaDbSongFixture();
    const duplicateSong = {
      ...base,
      id: 10_211,
      artists: [
        {
          ...base.artists[0],
          id: 2_101,
          name: matching.name,
          artist: {
            ...base.artists[0].artist!,
            id: 210,
            name: matching.name,
            additionalNames: "ExactAlias",
          },
        },
      ],
    };
    await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(duplicateSong)),
    );
    await db.artistName.createMany({
      data: [
        { artistId: matching.id, language: "English", value: "Name Match", position: 0 },
        { artistId: matching.id, language: "Japanese", value: "Name Match", position: 1 },
      ],
    });
    await db.artist.update({ where: { id: matching.id }, data: { defaultName: "Default Match" } });

    for (const q of ["100%", "100%_\\", "default", "name match", "ExactAlias"]) {
      const result = await listArtists({ q, page: 1, pageSize: 24 }, db);
      expect(result.items.map(({ id }) => id)).toEqual([matching.id]);
      expect(result.pagination.totalItems).toBe(1);
    }
    expect((await listArtists({ q: "exactalias", page: 1, pageSize: 24 }, db)).items).toEqual([]);
    expect((await listArtists({ q: "Exact", page: 1, pageSize: 24 }, db)).items).toEqual([]);
    expect((await listArtists({ q: "_", page: 1, pageSize: 24 }, db)).items).toEqual([expect.objectContaining({ id: matching.id })]);
    expect((await listArtists({ page: 1, pageSize: 24 }, db)).items.find(({ id }) => id === matching.id)?.publicSongCount).toBe(2);
  });

  it("orders by count, C-collated lower name, and UUID, with stable deep-page totals", async () => {
    const lower = await seedArtistSong(220, "alpha");
    const upper = await seedArtistSong(221, "Beta");
    await seedArtistSong(222, "Alpha", 10_222);
    const extraSong = await seedArtistSong(220, "alpha", 10_223);
    void extraSong;

    const result = await listArtists({ page: 1, pageSize: 24 }, db);
    expect(result.items.map(({ id }) => id).slice(0, 3)).toEqual([lower.id, (await db.artist.findUniqueOrThrow({ where: { vocadbId: 222 } })).id, upper.id]);

    const deep = await listArtists({ page: 9, pageSize: 24 }, db);
    expect(deep.items).toEqual([]);
    expect(deep.pagination).toMatchObject({ totalItems: 3, totalPages: 1 });
  });
});
