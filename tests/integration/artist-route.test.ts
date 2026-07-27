import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { GET as getArtist } from "@/app/api/artists/[id]/route";
import { GET as getWorks } from "@/app/api/artists/[id]/songs/route";
import { normalizeVocaDbArtist, normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbArtistDetail } from "@/lib/vocadb/sync-artist";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { vocaDbArtistDetailSchema, vocaDbSongSchema } from "@/lib/vocadb/contract";
import { makeVocaDbArtistFixture } from "../fixtures/vocadb/artist";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

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

async function seed() {
  const song = await syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture)),
  );
  const artist = await db.artist.findUniqueOrThrow({
    where: { vocadbId: 100 },
  });
  return { song, artist };
}

function artistRequest(id: string) {
  return getArtist(new Request(`http://localhost/api/artists/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function worksRequest(id: string, query = "") {
  return getWorks(
    new Request(
      `http://localhost/api/artists/${id}/songs${query ? `?${query}` : ""}`,
    ),
    { params: Promise.resolve({ id }) },
  );
}

describe("artist APIs", () => {
  it("rejects source IDs and returns 404 for unknown UUIDs", async () => {
    expect((await artistRequest("100")).status).toBe(400);
    expect(
      (
        await artistRequest("11111111-1111-4111-8111-111111111111")
      ).status,
    ).toBe(404);
  });

  it("returns artist detail with distinct public work count", async () => {
    const { artist } = await seed();
    const response = await artistRequest(artist.id);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: artist.id,
      vocadbId: 100,
      name: "Producer",
      worksCount: 1,
      source: { provider: "VocaDB" },
    });
    expect(payload).not.toHaveProperty("syncStatus");
    expect(payload).not.toHaveProperty("biography");
    expect(payload.avatar).toBeNull();
    expect(payload).not.toHaveProperty("avatarUrl");
  });

  it("returns independently synchronized profile fields and filters disabled links", async () => {
    const { artist } = await seed();
    await syncVocaDbArtistDetail(
      db,
      normalizeVocaDbArtist(
        vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
      ),
    );

    const response = await artistRequest(artist.id);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      defaultName: "Producer",
      description: "Independent artist description.\nSecond line.",
      aliases: expect.arrayContaining([
        { language: "Japanese", value: "制作者" },
        { language: null, value: "Producer Alias" },
      ]),
      avatar: { urlOriginal: "https://example.test/artist.png" },
      webLinks: [
        expect.objectContaining({ description: "Official site" }),
      ],
    });
    expect(payload.webLinks).toHaveLength(1);
    expect(payload).not.toHaveProperty("lastSyncError");
  });

  it("returns paginated works and target credit context", async () => {
    const { artist, song } = await seed();
    const response = await worksRequest(artist.id, "sort=popular&pageSize=1");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({
      id: song.id,
      coverUrlOriginal: "https://example.test/cover.jpg",
      coverUrlThumb: "https://example.test/cover-thumb.jpg",
      artistCredits: [
        { name: "Producer", effectiveRoles: ["Composer", "Arranger"] },
      ],
    });
    expect(payload.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("keeps one work while preserving multiple credits for the artist", async () => {
    const fixture = {
      ...vocaDbSongFixture,
      artists: [
        ...vocaDbSongFixture.artists,
        {
          ...vocaDbSongFixture.artists[0],
          id: 1002,
          name: "Producer support",
          roles: "Lyricist",
          effectiveRoles: "Lyricist",
          isSupport: true,
        },
      ],
    };
    const song = await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(fixture)),
    );
    const artist = await db.artist.findUniqueOrThrow({
      where: { vocadbId: 100 },
    });

    const response = await worksRequest(artist.id);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pagination.totalItems).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].id).toBe(song.id);
    expect(payload.items[0].artistCredits).toEqual([
      expect.objectContaining({ name: "Producer", isSupport: false }),
      expect.objectContaining({
        name: "Producer support",
        effectiveRoles: ["Lyricist"],
        isSupport: true,
      }),
    ]);
    expect(await db.artist.count()).toBe(1);
  });

  it("keeps failed snapshots public", async () => {
    const { artist, song } = await seed();
    await db.artist.update({
      where: { id: artist.id },
      data: { syncStatus: SyncStatus.FAILED },
    });
    await db.song.update({
      where: { id: song.id },
      data: { syncStatus: SyncStatus.FAILED },
    });

    expect((await artistRequest(artist.id)).status).toBe(200);
    const works = await worksRequest(artist.id);
    expect(works.status).toBe(200);
    expect((await works.json()).pagination.totalItems).toBe(1);
  });

  it("hides deleted or merged artist profiles", async () => {
    const { artist } = await seed();
    await syncVocaDbArtistDetail(
      db,
      normalizeVocaDbArtist(
        vocaDbArtistDetailSchema.parse(
          makeVocaDbArtistFixture({ deleted: true, mergedTo: 101 }),
        ),
      ),
    );
    expect((await artistRequest(artist.id)).status).toBe(404);
    expect((await worksRequest(artist.id)).status).toBe(404);
  });

  it("returns an empty out-of-range page with stable totals", async () => {
    const { artist } = await seed();
    const response = await worksRequest(artist.id, "page=2&pageSize=1");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
    expect(payload.pagination).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("validates works query", async () => {
    const { artist } = await seed();
    const response = await worksRequest(artist.id, "page=0");

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_QUERY");
  });

  it("hides artists with no public works", async () => {
    const { artist, song } = await seed();
    await db.song.update({
      where: { id: song.id },
      data: { sourceDeleted: true },
    });

    expect((await artistRequest(artist.id)).status).toBe(404);
    expect((await worksRequest(artist.id)).status).toBe(404);
  });
});
