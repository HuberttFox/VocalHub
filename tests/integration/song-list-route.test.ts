import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { GET } from "@/app/api/songs/route";
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

    const response = await requestSongs("q=100%25");
    const payload = await response.json();
    expect(payload.items.map((item: { title: string }) => item.title)).toEqual([
      "100% Song",
    ]);
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
