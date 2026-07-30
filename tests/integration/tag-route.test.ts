import "dotenv/config";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { GET as getTags } from "@/app/api/tags/route";
import { GET as getTag } from "@/app/api/tags/[id]/route";
import { GET as getTagSongs } from "@/app/api/tags/[id]/songs/route";
import { PUBLIC_TAG_WHERE } from "@/lib/catalog/visibility";
import * as dbModule from "@/lib/db";
import { getTagDetailById, listTagSongs, listTags } from "@/lib/tags/repository";
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

afterEach(() => {
  vi.restoreAllMocks();
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

function tagsRequest(query = "") {
  return getTags(new Request(`http://localhost/api/tags${query ? `?${query}` : ""}`));
}

function tagRequest(id: string) {
  return getTag(new Request(`http://localhost/api/tags/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function tagSongsRequest(id: string, query = "") {
  return getTagSongs(
    new Request(`http://localhost/api/tags/${id}/songs${query ? `?${query}` : ""}`),
    { params: Promise.resolve({ id }) },
  );
}

async function seedTagSong(
  tagId: number,
  tagName: string,
  songId = tagId + 10_000,
  additionalNames = "",
) {
  const fixture = makeVocaDbSongFixture();
  const song = {
    ...fixture,
    id: songId,
    name: `Song ${songId}`,
    defaultName: `Song ${songId}`,
    tags: [{
      count: 1,
      tag: {
        additionalNames,
        categoryName: "Genres",
        id: tagId,
        name: tagName,
        urlSlug: `tag-${tagId}`,
      },
    }],
  };
  const synced = await syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(song)),
  );
  return {
    song: synced,
    tag: await db.tag.findUniqueOrThrow({ where: { vocadbId: tagId } }),
  };
}

describe("tag APIs", () => {
  it("returns the public tag collection envelope with trimmed search", async () => {
    const matching = await seedTagSong(80, "Synth", 8001, "Exact Alias");
    const hidden = await seedTagSong(81, "Hidden", 8002);
    await db.song.update({ where: { id: hidden.song.id }, data: { sourceDeleted: true } });
    await db.tag.create({ data: { vocadbId: 82, name: "Orphan", additionalNames: [] } });

    const browse = await tagsRequest();
    expect(browse.status).toBe(200);
    expect(await browse.json()).toEqual({
      items: [{
        id: matching.tag.id,
        name: "Synth",
        additionalNames: ["Exact Alias"],
        publicSongCount: 1,
      }],
      query: { q: null },
      pagination: { page: 1, pageSize: 24, totalItems: 1, totalPages: 1 },
    });

    const searched = await tagsRequest("q=%20Synth%20");
    expect(searched.status).toBe(200);
    expect((await searched.json()).query).toEqual({ q: "Synth" });
  });

  it("rejects invalid and repeated tag collection parameters", async () => {
    for (const query of ["page=0", "page=1&page=2", "q=a&q=b", "pageSize=51"]) {
      const response = await tagsRequest(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "INVALID_QUERY", message: "Invalid tag list query" },
      });
    }
  });

  it("returns tag detail and paginated public songs", async () => {
    const first = await seedTagSong(90, "Shared", 9001, "Shared Alias");
    const second = await seedTagSong(90, "Shared", 9002, "Shared Alias");
    const hidden = await seedTagSong(90, "Shared", 9003, "Shared Alias");
    await db.song.update({
      where: { id: first.song.id },
      data: { publishDate: new Date("2024-01-01"), favoritedTimes: 10, ratingScore: 10 },
    });
    await db.song.update({
      where: { id: second.song.id },
      data: { publishDate: new Date("2025-01-01"), favoritedTimes: 5, ratingScore: 20 },
    });
    await db.song.update({
      where: { id: hidden.song.id },
      data: { sourceDeleted: true },
    });

    const detail = await tagRequest(first.tag.id);
    const detailPayload = await detail.json();
    expect(detail.status).toBe(200);
    expect(detailPayload).toEqual({
      id: first.tag.id,
      name: "Shared",
      additionalNames: ["Shared Alias"],
      publicSongCount: 2,
    });

    const latest = await tagSongsRequest(first.tag.id, "pageSize=1");
    const latestPayload = await latest.json();
    expect(latest.status).toBe(200);
    expect(latestPayload.items).toHaveLength(1);
    expect(latestPayload.items[0]).toMatchObject({
      id: second.song.id,
      title: "Song 9002",
      artistString: expect.any(String),
      credits: expect.any(Array),
      tags: [{ id: first.tag.id, name: "Shared" }],
      favoritedTimes: 5,
    });
    expect(latestPayload.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });

    const popular = await tagSongsRequest(first.tag.id, "sort=popular&pageSize=1");
    expect((await popular.json()).items[0].id).toBe(first.song.id);
  });

  it("rejects invalid IDs and queries with tag-specific errors", async () => {
    for (const id of ["90", "not-a-uuid"]) {
      for (const response of [await tagRequest(id), await tagSongsRequest(id)]) {
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("INVALID_TAG_ID");
      }
    }

    const { tag } = await seedTagSong(91, "Paged");
    for (const query of ["page=0", "sort=wrong", "page=1&page=2"]) {
      const response = await tagSongsRequest(tag.id, query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_QUERY");
    }
  });

  it("returns tag not found for unknown, orphan, and hidden-only tags", async () => {
    const unknownId = "11111111-1111-4111-8111-111111111111";
    const orphan = await db.tag.create({
      data: { vocadbId: 92, name: "Orphan", additionalNames: [] },
    });
    const hidden = await seedTagSong(93, "Hidden");
    await db.song.update({
      where: { id: hidden.song.id },
      data: { sourceDeleted: true },
    });

    for (const id of [unknownId, orphan.id, hidden.tag.id]) {
      for (const response of [await tagRequest(id), await tagSongsRequest(id)]) {
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe("TAG_NOT_FOUND");
      }
    }
  });

  it("logs repository failures without exposing them in either response", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const failure = new Error("database unavailable");
    vi.spyOn(dbModule, "getDb").mockImplementation(() => {
      throw failure;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const detail = await tagRequest(id);
    const songs = await tagSongsRequest(id);

    expect(detail.status).toBe(500);
    expect(await detail.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unable to load tag" },
    });
    expect(songs.status).toBe(500);
    expect(await songs.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unable to load tag songs" },
    });
    expect(log).toHaveBeenNthCalledWith(1, "Unable to load tag", failure);
    expect(log).toHaveBeenNthCalledWith(2, "Unable to load tag songs", failure);
  });

  it("returns an empty out-of-range songs page with stable totals", async () => {
    const { tag } = await seedTagSong(94, "Deep page");
    const response = await tagSongsRequest(tag.id, "page=2&pageSize=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      query: { sort: "latest" },
      pagination: { page: 2, pageSize: 1, totalItems: 1, totalPages: 1 },
    });
  });
});

describe("tag catalog repository", () => {
  it("uses the public tag collection and distinct public song counts", async () => {
    const synced = await seedTagSong(100, "Synced");
    const failed = await seedTagSong(101, "Failed");
    const hidden = await seedTagSong(102, "Hidden");
    const orphan = await db.tag.create({
      data: { vocadbId: 103, name: "Orphan", additionalNames: [] },
    });

    await db.song.update({
      where: { id: failed.song.id },
      data: { syncStatus: SyncStatus.FAILED },
    });
    await db.song.update({ where: { id: hidden.song.id }, data: { sourceDeleted: true } });

    const result = await listTags({ page: 1, pageSize: 24 }, db);
    const expected = await db.tag.findMany({
      where: PUBLIC_TAG_WHERE,
      select: { id: true },
      orderBy: { id: "asc" },
    });

    expect(result.items.map(({ id }) => id).sort()).toEqual(expected.map(({ id }) => id));
    expect(result.items.map(({ id }) => id)).toEqual([failed.tag.id, synced.tag.id]);
    expect(result.pagination.totalItems).toBe(2);
    expect(result.items.every(({ publicSongCount }) => publicSongCount === 1)).toBe(true);
    await expect(getTagDetailById(hidden.tag.id, db)).resolves.toBeNull();
    await expect(getTagDetailById(orphan.id, db)).resolves.toBeNull();
  });

  it("lists only public songs for a public tag", async () => {
    const tag = await seedTagSong(105, "Shared", 10_105);
    const hidden = await seedTagSong(105, "Shared", 10_106);
    await db.song.update({ where: { id: hidden.song.id }, data: { sourceDeleted: true } });

    await expect(listTagSongs(tag.tag.id, { page: 1, pageSize: 24, sort: "latest" }, db))
      .resolves.toMatchObject({
        items: [expect.objectContaining({ id: tag.song.id })],
        pagination: { totalItems: 1 },
      });
  });

  it("uses literal tag names and exact case-sensitive additional name members", async () => {
    const matching = await seedTagSong(110, "100%_\\ Tag", 10_110, "ExactAlias");
    await seedTagSong(111, "100xA Tag", 10_111);

    for (const q of ["100%", "100%_\\", "ExactAlias"]) {
      const result = await listTags({ q, page: 1, pageSize: 24 }, db);
      expect(result.items.map(({ id }) => id)).toEqual([matching.tag.id]);
    }
    await expect(listTags({ q: "exactalias", page: 1, pageSize: 24 }, db))
      .resolves.toMatchObject({ items: [] });
    await expect(listTags({ q: "Exact", page: 1, pageSize: 24 }, db))
      .resolves.toMatchObject({ items: [] });
  });

  it("normalizes aliases and orders stably with deep-page totals", async () => {
    const lower = await seedTagSong(120, "alpha", 10_120, " synth , ,Synth,synth, synth ,electronic");
    const upper = await seedTagSong(121, "Beta");
    await seedTagSong(122, "Alpha", 10_122);
    await seedTagSong(120, "alpha", 10_123, " synth , ,Synth,synth, synth ,electronic");

    const first = await listTags({ page: 1, pageSize: 24 }, db);
    expect(first.items.map(({ id }) => id).slice(0, 3)).toEqual([
      lower.tag.id,
      (await db.tag.findUniqueOrThrow({ where: { vocadbId: 122 } })).id,
      upper.tag.id,
    ]);
    expect(first.items.find(({ id }) => id === lower.tag.id)?.additionalNames)
      .toEqual(["synth", "Synth", "electronic"]);

    const deep = await listTags({ page: 9, pageSize: 24 }, db);
    expect(deep.items).toEqual([]);
    expect(deep.pagination).toMatchObject({ totalItems: 3, totalPages: 1 });
  });
});
