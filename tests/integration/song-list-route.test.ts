import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { GET } from "@/app/api/songs/route";
import {
  listSongs,
  listSongsInTransaction,
  listSongsWithBroadSearch,
} from "@/lib/songs/repository";
import { listSongsWithDecomposedSearch } from "@/lib/songs/search-query";
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
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

function requestSongs(query = "") {
  return GET(new Request(`http://localhost/api/songs${query ? `?${query}` : ""}`));
}

async function seedSong(overrides: Record<string, unknown> = {}) {
  const fixture = makeVocaDbSongFixture();
  Object.assign(fixture, overrides);
  return syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(fixture)),
  );
}

describe("GET /api/songs", () => {
  it("validates query parameters", async () => {
    const response = await requestSongs("page=0");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_QUERY", message: "Invalid song list query" },
    });
  });

  it.each([
    ["main title", "fixture"],
    ["localized alias", "フィクスチャ"],
    ["artist string", "singer"],
    ["linked artist", "producer"],
    ["custom credit", "custom chorus"],
    ["tag", "ELECTRONIC"],
    ["exact tag alias", "synth"],
  ])("finds a song by %s", async (_field, query) => {
    const song = await seedSong();
    const response = await requestSongs(`q=${encodeURIComponent(query)}`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: song.id, title: "Fixture Song" });
  });

  it("treats LIKE wildcard characters literally", async () => {
    await seedSong({ id: 124, name: "100% Song", defaultName: "100% Song" });
    await seedSong({ id: 125, name: "100x Song", defaultName: "100x Song" });
    await seedSong({
      id: 126,
      name: "Literal_under",
      defaultName: "Literal_under",
    });
    await seedSong({
      id: 127,
      name: "LiteralXunder",
      defaultName: "LiteralXunder",
    });
    await seedSong({
      id: 128,
      name: "Literal\\slash",
      defaultName: "Literal\\slash",
    });
    await seedSong({
      id: 129,
      name: "LiteralXslash",
      defaultName: "LiteralXslash",
    });

    const percent = await requestSongs("q=100%25");
    const underscore = await requestSongs(
      `q=${encodeURIComponent("literal_")}`,
    );
    const backslash = await requestSongs(
      `q=${encodeURIComponent("literal\\")}`,
    );

    expect((await percent.json()).items.map((item: { title: string }) => item.title)).toEqual([
      "100% Song",
    ]);
    expect((await underscore.json()).items.map((item: { title: string }) => item.title)).toEqual([
      "Literal_under",
    ]);
    expect((await backslash.json()).items.map((item: { title: string }) => item.title)).toEqual([
      "Literal\\slash",
    ]);
  });

  it("uses substring tag names and exact case-sensitive tag aliases", async () => {
    const song = await seedSong({
      id: 124,
      name: "Unrelated Song",
      defaultName: "Unrelated Song",
      tags: [
        {
          count: 1,
          tag: {
            additionalNames: "CaseAlias, Long Alias",
            categoryName: "Genres",
            id: 301,
            name: "Dream Pop",
            urlSlug: "dream-pop",
          },
        },
      ],
    });

    const nameSubstring = await requestSongs("q=dream");
    const exactAlias = await requestSongs("q=CaseAlias");
    const wrongCaseAlias = await requestSongs("q=casealias");
    const aliasSubstring = await requestSongs("q=Case");

    expect((await nameSubstring.json()).items.map((item: { id: string }) => item.id)).toEqual([
      song.id,
    ]);
    expect((await exactAlias.json()).items.map((item: { id: string }) => item.id)).toEqual([
      song.id,
    ]);
    expect((await wrongCaseAlias.json()).items).toEqual([]);
    expect((await aliasSubstring.json()).items).toEqual([]);
  });

  it("counts a song matching multiple search branches once", async () => {
    const song = await seedSong({
      artistString: "Overlap Match",
      defaultName: "Overlap Match",
      name: "Overlap Match",
      names: [{ language: "English", value: "Overlap Match" }],
    });

    const response = await requestSongs("q=overlap");
    const payload = await response.json();

    expect(payload.items.map((item: { id: string }) => item.id)).toEqual([song.id]);
    expect(payload.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
  });

  it("filters hidden songs while retaining failed snapshots", async () => {
    const synced = await seedSong({ id: 124, name: "Synced", defaultName: "Synced" });
    const failed = await seedSong({ id: 125, name: "Failed", defaultName: "Failed" });
    const missing = await seedSong({ id: 126, name: "Missing", defaultName: "Missing" });
    const deleted = await seedSong({
      id: 127,
      name: "Deleted",
      defaultName: "Deleted",
      deleted: true,
    });

    await db.song.update({ where: { id: failed.id }, data: { syncStatus: SyncStatus.FAILED } });
    await db.song.update({ where: { id: missing.id }, data: { syncStatus: SyncStatus.SOURCE_MISSING } });

    const response = await requestSongs();
    const payload = await response.json();
    expect(payload.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [synced.id, failed.id].sort(),
    );
    expect(payload.items[0]).not.toHaveProperty("syncStatus");
    expect(payload.items.map((item: { id: string }) => item.id)).not.toContain(deleted.id);
  });

  it("applies visibility rules to searched songs", async () => {
    const synced = await seedSong({
      id: 124,
      name: "Search Visible Synced",
      defaultName: "Search Visible Synced",
    });
    const failed = await seedSong({
      id: 125,
      name: "Search Visible Failed",
      defaultName: "Search Visible Failed",
    });
    const missing = await seedSong({
      id: 126,
      name: "Search Visible Missing",
      defaultName: "Search Visible Missing",
    });
    const deleted = await seedSong({
      id: 127,
      name: "Search Visible Deleted",
      defaultName: "Search Visible Deleted",
      deleted: true,
    });

    await db.song.update({
      where: { id: failed.id },
      data: { syncStatus: SyncStatus.FAILED },
    });
    await db.song.update({
      where: { id: missing.id },
      data: { syncStatus: SyncStatus.SOURCE_MISSING },
    });

    const response = await requestSongs("q=search%20visible");
    const payload = await response.json();

    expect(payload.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [synced.id, failed.id].sort(),
    );
    expect(payload.pagination.totalItems).toBe(2);
    expect(payload.items.map((item: { id: string }) => item.id)).not.toContain(
      deleted.id,
    );
  });

  it("returns cover URLs and nulls when no cover exists", async () => {
    const covered = await seedSong();
    const uncovered = await seedSong({
      id: 124,
      name: "No cover",
      defaultName: "No cover",
      mainPicture: null,
    });

    const response = await requestSongs();
    const payload = await response.json();
    const coveredItem = payload.items.find(
      (item: { id: string }) => item.id === covered.id,
    );
    const uncoveredItem = payload.items.find(
      (item: { id: string }) => item.id === uncovered.id,
    );

    expect(response.status).toBe(200);
    expect(coveredItem).toMatchObject({
      coverUrlOriginal: "https://example.test/cover.jpg",
      coverUrlThumb: "https://example.test/cover-thumb.jpg",
    });
    expect(uncoveredItem).toMatchObject({
      coverUrlOriginal: null,
      coverUrlThumb: null,
    });
  });

  it("orders searched latest and popular ties deterministically", async () => {
    const first = await seedSong({
      id: 124,
      artistString: "Ordering Search",
      createDate: "2026-07-02T00:00:00Z",
      defaultName: "Ordering First",
      favoritedTimes: 50,
      name: "Ordering First",
      publishDate: "2026-06-01T00:00:00Z",
      ratingScore: 100,
    });
    const second = await seedSong({
      id: 125,
      artistString: "Ordering Search",
      createDate: "2026-07-02T00:00:00Z",
      defaultName: "Ordering Second",
      favoritedTimes: 50,
      name: "Ordering Second",
      publishDate: "2026-06-01T00:00:00Z",
      ratingScore: 100,
    });
    const older = await seedSong({
      id: 126,
      artistString: "Ordering Search",
      createDate: "2026-07-01T00:00:00Z",
      defaultName: "Ordering Older",
      favoritedTimes: 50,
      name: "Ordering Older",
      publishDate: "2026-06-01T00:00:00Z",
      ratingScore: 100,
    });
    const newestIds = [first.id, second.id].sort();
    const allIds = [first.id, second.id, older.id].sort();

    const latestResponse = await requestSongs("q=ordering%20search&sort=latest");
    const popularResponse = await requestSongs(
      "q=ordering%20search&sort=popular",
    );

    expect(
      (await latestResponse.json()).items.map((item: { id: string }) => item.id),
    ).toEqual([...newestIds, older.id]);
    expect(
      (await popularResponse.json()).items.map((item: { id: string }) => item.id),
    ).toEqual(allIds);
  });

  it("returns searched empty and deep pagination metadata", async () => {
    await seedSong({
      id: 124,
      artistString: "Pagination Search",
      defaultName: "Pagination One",
      name: "Pagination One",
    });
    await seedSong({
      id: 125,
      artistString: "Pagination Search",
      defaultName: "Pagination Two",
      name: "Pagination Two",
    });

    const emptyResponse = await requestSongs("q=no-search-results&page=4&pageSize=1");
    const deepResponse = await requestSongs(
      "q=pagination%20search&page=9&pageSize=1",
    );
    const empty = await emptyResponse.json();
    const deep = await deepResponse.json();

    expect(empty.items).toEqual([]);
    expect(empty.pagination).toEqual({
      page: 4,
      pageSize: 1,
      totalItems: 0,
      totalPages: 0,
    });
    expect(deep.items).toEqual([]);
    expect(deep.pagination).toEqual({
      page: 9,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
  });

  it("keeps decomposed search equivalent to broad search semantics", async () => {
    await seedSong({ id: 124, name: "100% Literal_under\\slash", defaultName: "Overlap Match" });
    await seedSong({ id: 125, name: "Failed Overlap Match", defaultName: "Failed Overlap Match" });
    const failed = await db.song.findFirstOrThrow({ where: { vocadbId: 125 } });
    await db.song.update({ where: { id: failed.id }, data: { syncStatus: SyncStatus.FAILED } });

    for (const q of ["100%", "Literal_", "Literal\\", "overlap", "synth", "ELECTRONIC"]) {
      for (const sort of ["latest", "popular"] as const) {
        const query = { q, sort, page: 1, pageSize: 1 };
        const broad = await listSongsWithBroadSearch(query, db);
        const decomposed = await listSongsWithDecomposedSearch(query, db);
        expect(decomposed).toEqual(broad);
      }
    }

    const deep = { q: "overlap", sort: "latest" as const, page: 9, pageSize: 1 };
    expect(await listSongsWithDecomposedSearch(deep, db))
      .toEqual(await listSongsWithBroadSearch(deep, db));
  });

  it("runs unsearched lists inside a caller-owned transaction", async () => {
    await seedSong({ id: 124, name: "Low", defaultName: "Low", favoritedTimes: 1 });
    await seedSong({ id: 125, name: "High", defaultName: "High", favoritedTimes: 99 });
    const query = { sort: "popular" as const, page: 2, pageSize: 1 };

    const expected = await listSongs(query, db);
    const actual = await db.$transaction(
      (tx) => listSongsInTransaction(query, tx),
      { isolationLevel: "RepeatableRead" },
    );

    expect(actual).toEqual(expected);
  });

  it("runs searched lists inside a caller-owned transaction", async () => {
    await seedSong({ id: 124, name: "100% Match", defaultName: "100% Match" });
    await seedSong({ id: 125, name: "100x Match", defaultName: "100x Match" });
    const query = { q: "100%", sort: "latest" as const, page: 1, pageSize: 1 };

    const expected = await listSongsWithBroadSearch(query, db);
    const actual = await db.$transaction(
      (tx) => listSongsInTransaction(query, tx),
      { isolationLevel: "RepeatableRead" },
    );

    expect(actual).toEqual(expected);
  });

  it("paginates and supports popular sorting", async () => {
    const low = await seedSong({
      id: 124,
      name: "Low",
      defaultName: "Low",
      favoritedTimes: 1,
    });
    const high = await seedSong({
      id: 125,
      name: "High",
      defaultName: "High",
      favoritedTimes: 99,
    });

    const firstResponse = await requestSongs("sort=popular&pageSize=1");
    const first = await firstResponse.json();
    expect(first.items[0].id).toBe(high.id);
    expect(first.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });

    const secondResponse = await requestSongs("sort=popular&pageSize=1&page=2");
    const second = await secondResponse.json();
    expect(second.items[0].id).toBe(low.id);

    const emptyResponse = await requestSongs("page=9");
    const empty = await emptyResponse.json();
    expect(empty.items).toEqual([]);
    expect(empty.pagination.totalItems).toBe(2);
  });
});
